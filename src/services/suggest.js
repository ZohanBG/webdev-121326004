// The model feature: turns a plain-language request into one concrete free slot.
// This is the only file that names the model provider. Tests pass in a fake client; the real API is
// never called in tests. Every failure ends in the same fallback, and nothing is booked until the
// student presses Book.
import * as requests from '../data/suggestionRequests.js';
import * as bookings from '../data/bookings.js';
import { listFreeSlots } from './bookings.js';
import { InvalidInput, Forbidden } from './errors.js';
import { requireUser } from './access.js';
import { startOfToday, today } from './time.js';

export const FALLBACK = 'Suggestions are not available right now. Pick a free slot from the list below.';
export const LIMIT_REACHED = "You have used today's 10 suggestions. Pick a free slot from the list below.";
const NOTHING_FREE = 'There is no free slot in the next 14 days.';

const DAILY_LIMIT = 10;
const MAX_REQUEST = 300;
const MAX_REASON = 200;
const MAX_TOKENS = 200;
const TIMEOUT_MS = 8000;

const SYSTEM = `You help a university student pick one lab workstation slot.
You get today's date, the student's request and the free slots. Each line is one date and time, then the free slots at that time, separated by ";".
Each slot starts with its slot id, written as workstationId:date:block, for example 3:2026-11-26:4, followed by the workstation, the lab and its features.
Answer with one JSON object and nothing else: {"slotId": "<only the slot id, copied exactly, e.g. 3:2026-11-26:4>", "reason": "<one short sentence, under 150 characters, saying why it fits>"}.
Never invent a slot. If nothing fits well, pick the closest one and say why in the reason.`;

/** A slot id inside a longer string, e.g. "3:2026-11-26:4 NL-03, Networks Lab". */
const SLOT_ID = /\b\d+:\d{4}-\d{2}-\d{2}:[1-6]\b/;

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's finishReason in the words the service uses; anything else (SAFETY, RECITATION, ...) is a refusal. */
const STOP_REASON = { STOP: 'end_turn', MAX_TOKENS: 'max_tokens' };

/**
 * The real client, or null without a key (the app then always shows the fallback).
 * One plain fetch to generateContent, no retries: the free-tier quota is shared with the class.
 * The key goes in a header, never in the URL, so it cannot end up in a log line. No thinking
 * setting is sent: models differ in which values they accept, and a rejected value would turn
 * every request into an error; the default model thinks minimally on its own.
 */
export function createModelClient({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  baseURL = GEMINI,
} = {}) {
  if (!apiKey) return null;
  return {
    model,
    async complete({ system, prompt, signal }) {
      const res = await fetch(`${baseURL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' },
        }),
        signal,
      });
      if (!res.ok) throw Object.assign(new Error(`the model API answered ${res.status}`), { status: res.status });
      const data = await res.json();
      // a blocked prompt comes back with no candidates at all
      const candidate = data.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
      const reason = candidate?.finishReason ?? 'BLOCKED';
      return { stopReason: STOP_REASON[reason] ?? reason.toLowerCase(), text };
    },
  };
}

/** Free slots grouped by date and block, so the prompt stays small. No names, emails or user ids. */
function buildPrompt(text, slots, now) {
  const groups = new Map();
  for (const s of slots) {
    const key = `${s.date} ${s.start}–${s.end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${s.slotId} ${s.workstation}, ${s.lab}${s.features.length ? ` (${s.features.join(', ')})` : ''}`);
  }
  const lines = [...groups].map(([when, list]) => `${when}: ${list.join('; ')}`);
  return `Today is ${today(now)}.\nRequest: ${text}\nFree slots:\n${lines.join('\n')}`;
}

/** How a failed call ended, as stored in suggestion_requests. */
function outcomeOf(error) {
  if (error?.status === 429) return '429';
  if (error?.status === 503) return '503';
  if (error?.status === 529) return '529';
  if (error?.name === 'TimeoutError') return 'timeout';
  return 'error';
}

function withTimeout(promise, ms, controller) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('the model did not answer in time'), { name: 'TimeoutError' }));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The model's text as a suggestion for one of the offered slots: { suggestion }, or { why } it was
 * refused. `why` is a category for the log, never the model's text, which can echo the student's words.
 * Two harmless variations are accepted: the object wrapped in a one-item array, and the slot id with
 * the workstation name after it. Either way the slot must be one that was offered.
 */
function parseReply(text, offered) {
  let data;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return { why: 'not JSON' };
  }
  if (Array.isArray(data) && data.length === 1) [data] = data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { why: 'not a JSON object' };
  const id = typeof data.slotId === 'string' ? data.slotId.match(SLOT_ID)?.[0] : undefined;
  if (!id) return { why: 'no slot id in slotId' };
  const slot = offered.get(id);
  if (!slot) return { why: 'a slot id that was not offered' };
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (!reason || reason.length >= MAX_REASON || /[<>]/.test(reason)) return { why: 'no short plain-text reason' };
  return { suggestion: { ...slot, reason } };
}

/**
 * One suggestion for a student. Returns { suggestion } or { suggestion: null, message }.
 * Every request that reaches the model is counted, whatever the outcome; requests refused before
 * the call (bad input, the daily limit, no key) are not.
 */
export async function suggestSlot(db, user, { text } = {}, {
  client, now = new Date(), timeoutMs = TIMEOUT_MS, log = (line) => console.warn(line),
} = {}) {
  requireUser(user);
  if (user.role === 'staff') throw new Forbidden('Suggestions are for students booking a workstation.');
  if (typeof text !== 'string' || !text.trim()) {
    throw new InvalidInput('Describe what you need, for example "quiet place on Thursday afternoon".');
  }
  if (text.length > MAX_REQUEST) throw new InvalidInput('Keep the request under 300 characters.');
  if (!client) return { suggestion: null, message: FALLBACK };
  if ((await requests.countSince(db, user.id, startOfToday(now))) >= DAILY_LIMIT) {
    return { suggestion: null, message: LIMIT_REACHED };
  }

  const slots = await listFreeSlots(db, user, {}, now);
  if (slots.length === 0) return { suggestion: null, message: NOTHING_FREE };
  const offered = new Map(slots.map((s) => [s.slotId, s]));

  let outcome;
  let why = '';
  let suggestion = null;
  try {
    const controller = new AbortController();
    const reply = await withTimeout(
      client.complete({ system: SYSTEM, prompt: buildPrompt(text.trim(), slots, now), signal: controller.signal }),
      timeoutMs,
      controller,
    );
    if (reply.stopReason === 'max_tokens') outcome = 'truncated';
    else if (reply.stopReason !== 'end_turn') {
      outcome = 'invalid';
      why = `stopped: ${reply.stopReason}`;
    } else {
      ({ suggestion = null, why = '' } = parseReply(reply.text, offered));
      // checked against the database again: the slot may have been booked while the model was thinking
      if (suggestion && (await bookings.findActiveAt(db, suggestion))) {
        suggestion = null;
        why = 'the slot was booked meanwhile';
      }
      outcome = suggestion ? 'ok' : 'invalid';
    }
  } catch (error) {
    outcome = outcomeOf(error);
    if (outcome === 'error') why = error.status ? `status ${error.status}` : error.name;
  }
  await requests.record(db, { userId: user.id, outcome, at: now });
  // the outcome and a category only: never the request text or the model's answer
  log(`suggestion: ${outcome}${why ? ` (${why})` : ''}`);
  return suggestion ? { suggestion } : { suggestion: null, message: FALLBACK };
}
