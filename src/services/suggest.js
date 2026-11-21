// The model feature: turns a plain-language request into one concrete free slot.
// This is the only file that names the model provider. Tests pass in a fake client; the real API is
// never called in tests. Every failure ends in the same fallback, and nothing is booked until the
// student presses Book.
import Anthropic from '@anthropic-ai/sdk';
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
You get today's date, the student's request and a list of free slots, one per line, each starting with its slot id.
Answer with one JSON object and nothing else: {"slotId": "<a slot id copied exactly from the list>", "reason": "<one short sentence, under 150 characters, saying why it fits>"}.
Never invent a slot. If nothing fits well, pick the closest one and say why in the reason.`;

/**
 * The real client, or null without a key (the app then always shows the fallback).
 * Thinking is off: picking one slot from a given list needs no reasoning, and thinking tokens
 * would count against the 200-token cap. No retries: one paid call per request.
 */
export function createModelClient({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  baseURL,
} = {}) {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, baseURL, maxRetries: 0, timeout: TIMEOUT_MS });
  return {
    model,
    async complete({ system, prompt, signal }) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: prompt }],
      }, { signal });
      const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      return { stopReason: response.stop_reason, text };
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
  if (error?.status === 529) return '529';
  if (error?.name === 'TimeoutError' || error?.name === 'APIConnectionTimeoutError') return 'timeout';
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

/** The model's text as a suggestion for one of the offered slots, or null if it is anything else. */
function parseReply(text, offered) {
  let data;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return null;
  }
  const slot = typeof data?.slotId === 'string' ? offered.get(data.slotId) : undefined;
  const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
  if (!slot || !reason || reason.length >= MAX_REASON || /[<>]/.test(reason)) return null;
  return { ...slot, reason };
}

/**
 * One suggestion for a student. Returns { suggestion } or { suggestion: null, message }.
 * Every request that reaches the model is counted, whatever the outcome; requests refused before
 * the call (bad input, the daily limit, no key) are not.
 */
export async function suggestSlot(db, user, { text } = {}, { client, now = new Date(), timeoutMs = TIMEOUT_MS } = {}) {
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
  let suggestion = null;
  try {
    const controller = new AbortController();
    const reply = await withTimeout(
      client.complete({ system: SYSTEM, prompt: buildPrompt(text.trim(), slots, now), signal: controller.signal }),
      timeoutMs,
      controller,
    );
    if (reply.stopReason === 'max_tokens') outcome = 'truncated';
    else if (reply.stopReason !== 'end_turn') outcome = 'invalid';
    else {
      suggestion = parseReply(reply.text, offered);
      // checked against the database again: the slot may have been booked while the model was thinking
      if (suggestion && (await bookings.findActiveAt(db, suggestion))) suggestion = null;
      outcome = suggestion ? 'ok' : 'invalid';
    }
  } catch (error) {
    outcome = outcomeOf(error);
  }
  await requests.record(db, { userId: user.id, outcome, at: now });
  return suggestion ? { suggestion } : { suggestion: null, message: FALLBACK };
}
