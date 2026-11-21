// The model feature, called directly on the service with fake model clients: the real API is never called.
// "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { suggestSlot, createModelClient, FALLBACK, LIMIT_REACHED } from '../src/services/suggest.js';
import { createBooking } from '../src/services/bookings.js';
import { freshDb, userByEmail, workstationIds, STUDENT, STUDENT2, STAFF } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const TUE = '2026-11-24';

let db;
let student;
let ws;
beforeEach(async () => {
  db = await freshDb();
  student = await userByEmail(db, STUDENT);
  ws = await workstationIds(db);
});
afterEach(async () => {
  await db.close();
});

/** A fake model client: records what it was asked and answers with `reply` (or throws, or never answers). */
function fakeModel(reply) {
  const calls = [];
  return {
    calls,
    model: 'fake',
    complete: async (request) => {
      calls.push(request);
      if (reply instanceof Error) throw reply;
      if (reply === 'hang') return new Promise(() => {});
      return reply;
    },
  };
}
const answer = (data, stopReason = 'end_turn') => ({ stopReason, text: typeof data === 'string' ? data : JSON.stringify(data) });
const statusError = (status) => Object.assign(new Error(`status ${status}`), { status });

const ask = (client, text = 'quiet place with two monitors on Tuesday afternoon', options = {}) =>
  suggestSlot(db, student, { text }, { client, now: NOW, ...options });
const outcomes = async () => (await db.query('SELECT outcome FROM suggestion_requests ORDER BY id')).rows.map((r) => r.outcome);
const bookingCount = async () => (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;

describe('a good answer', () => {
  test('AC-17 a free slot from the model is shown with a reason and a way to book it, and nothing is booked yet', async () => {
    const slotId = `${ws.NL03}:${TUE}:4`;
    const client = fakeModel(answer({ slotId, reason: 'NL-03 is quiet and has two monitors.' }));
    const result = await ask(client);

    expect(result.suggestion).toMatchObject({
      slotId, workstationId: ws.NL03, date: TUE, block: 4, start: '14:00', end: '16:00',
      workstation: 'NL-03', lab: 'Networks Lab', features: ['quiet', 'dual-monitor', 'linux', 'windows'], reason: 'NL-03 is quiet and has two monitors.',
    });
    expect(await bookingCount()).toBe(0);
    expect(await outcomes()).toEqual(['ok']);
  });

  test('AC-17 the model gets the request, today and the free slots, and nothing that identifies the student', async () => {
    await createBooking(db, await userByEmail(db, STUDENT2), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    await createBooking(db, student, { workstationId: ws.GL01, date: TUE, block: 2 }, NOW);
    const client = fakeModel(answer({ slotId: `${ws.NL02}:${TUE}:3`, reason: 'Free on Tuesday.' }));
    await ask(client);

    const prompt = client.calls[0].prompt;
    expect(prompt).toContain('quiet place with two monitors on Tuesday afternoon');
    expect(prompt).toContain('2026-11-23');
    expect(prompt).toContain(`${ws.NL02}:${TUE}:3`);
    expect(prompt).not.toContain(`${ws.NL01}:${TUE}:3`); // taken by someone else
    expect(prompt).not.toContain(`${ws.NL02}:${TUE}:2`); // the student already has a booking in that block
    expect(prompt).not.toContain(`${ws.NL01}:2026-11-23:1`); // started already
    expect(prompt).not.toContain('NL-04'); // out of service
    expect(prompt).not.toMatch(/labspot\.test|student/i);
  });

  test('AC-17 a workstation with no features is offered by its label and lab alone', async () => {
    await db.query("INSERT INTO workstations (lab_id, label) SELECT id, 'PR-01' FROM labs WHERE name = 'Project Room'");
    const client = fakeModel(answer({ slotId: `${ws.NL01}:${TUE}:3`, reason: 'Free.' }));
    await ask(client);
    expect(client.calls[0].prompt).toMatch(/:\d PR-01, Project Room(;|\n|$)/);
  });
});

describe('every failure ends the same way', () => {
  const cases = [
    ['a timeout', 'hang', 'timeout'],
    ['a 429 rate limit', statusError(429), '429'],
    ['a 529 overload', statusError(529), '529'],
    ['another provider error', statusError(500), 'error'],
    ['a reply cut off at max_tokens', answer('{"slotId": "1:2026-11-24', 'max_tokens'), 'truncated'],
    ['a refusal', answer('{}', 'refusal'), 'invalid'],
    ['broken JSON', answer('Sure! Here is a slot'), 'invalid'],
    ['a slot id that was never offered', answer({ slotId: '999:2026-11-24:3', reason: 'Looks good.' }), 'invalid'],
    ['a reason that is not short plain text', answer({ slotId: 'PLACEHOLDER', reason: '<b>great</b>' }), 'invalid'],
    ['a missing reason', answer({ slotId: 'PLACEHOLDER' }), 'invalid'],
    ['a slot id that is not text', answer({ slotId: 5, reason: 'Free.' }), 'invalid'],
    ['JSON that is not an object', answer('null'), 'invalid'],
  ];
  for (const [what, reply, outcome] of cases) {
    test(`AC-18 ${what} shows the fallback message, books nothing, and records "${outcome}"`, async () => {
      if (reply.text?.includes('PLACEHOLDER')) reply.text = reply.text.replace('PLACEHOLDER', `${ws.NL01}:${TUE}:3`);
      const result = await ask(fakeModel(reply), undefined, { timeoutMs: 50 });
      expect(result).toEqual({ suggestion: null, message: FALLBACK });
      expect(await bookingCount()).toBe(0);
      expect(await outcomes()).toEqual([outcome]);
    });
  }

  test('AC-18 a slot that was booked while the model was thinking is not suggested', async () => {
    const slotId = `${ws.NL01}:${TUE}:3`;
    const client = {
      model: 'fake',
      complete: async () => {
        await createBooking(db, await userByEmail(db, STUDENT2), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
        return answer({ slotId, reason: 'Free on Tuesday.' });
      },
    };
    expect(await ask(client)).toEqual({ suggestion: null, message: FALLBACK });
    expect(await outcomes()).toEqual(['invalid']);
  });

  test('AC-18 with no key there is no client: the fallback is shown and nothing is recorded, as the model was never called', async () => {
    expect(await ask(null)).toEqual({ suggestion: null, message: FALLBACK });
    expect(await outcomes()).toEqual([]);
  });
});

describe('the daily limit and the rules before any call', () => {
  test("AC-29 a student with 10 requests today gets the limit message, the model is not called and no row is added", async () => {
    for (let i = 0; i < 10; i++) {
      await db.query("INSERT INTO suggestion_requests (user_id, created_at, outcome) VALUES ($1, $2, 'ok')", [student.id, NOW]);
    }
    // one from yesterday does not count
    await db.query("INSERT INTO suggestion_requests (user_id, created_at, outcome) VALUES ($1, '2026-11-22T20:00:00Z', 'ok')", [student.id]);
    const client = fakeModel(answer({ slotId: `${ws.NL01}:${TUE}:3`, reason: 'x' }));

    expect(await ask(client)).toEqual({ suggestion: null, message: LIMIT_REACHED });
    expect(client.calls).toHaveLength(0);
    expect(await outcomes()).toHaveLength(11);
  });

  test('AC-29 the tenth request of the day is still answered', async () => {
    for (let i = 0; i < 9; i++) {
      await db.query("INSERT INTO suggestion_requests (user_id, created_at, outcome) VALUES ($1, $2, 'timeout')", [student.id, NOW]);
    }
    const result = await ask(fakeModel(answer({ slotId: `${ws.NL01}:${TUE}:3`, reason: 'Free on Tuesday.' })));
    expect(result.suggestion).toMatchObject({ workstation: 'NL-01' });
  });

  test('an empty request, a request over 300 characters, staff and a visitor are refused before any call', async () => {
    const client = fakeModel(answer({}));
    await expect(ask(client, '   ')).rejects.toMatchObject({ name: 'InvalidInput', message: 'Describe what you need, for example "quiet place on Thursday afternoon".' });
    await expect(ask(client, 'x'.repeat(301))).rejects.toMatchObject({ name: 'InvalidInput', message: 'Keep the request under 300 characters.' });
    await expect(suggestSlot(db, await userByEmail(db, STAFF), { text: 'any' }, { client, now: NOW }))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'Suggestions are for students booking a workstation.' });
    await expect(suggestSlot(db, null, { text: 'any' }, { client, now: NOW })).rejects.toMatchObject({ name: 'NotSignedIn' });
    await expect(suggestSlot(db, student, undefined, { client, now: NOW })).rejects.toMatchObject({ name: 'InvalidInput' });
    expect(client.calls).toHaveLength(0);
    expect(await outcomes()).toEqual([]);
  });

  test('when every workstation is booked for 14 days the student is told so, without calling the model', async () => {
    await db.query('UPDATE workstations SET in_service = false');
    const client = fakeModel(answer({}));
    expect(await ask(client)).toEqual({ suggestion: null, message: 'There is no free slot in the next 14 days.' });
    expect(client.calls).toHaveLength(0);
  });
});

describe('the real client', () => {
  test('without GEMINI_API_KEY there is no client, so the app runs on its fallback', () => {
    expect(createModelClient({ apiKey: '' })).toBeNull();
  });

  // A local stand-in for the Gemini API, so the real client can be exercised with no network and no quota.
  async function standIn(status, body) {
    const received = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        received.push({ path: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(raw) });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { received, url: `http://127.0.0.1:${server.address().port}/v1beta`, close: () => new Promise((r) => server.close(r)) };
  }
  const geminiReply = (text, finishReason = 'STOP') => ({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });

  test('sends one generateContent request with the key in a header and a 200-token cap, and returns the text', async () => {
    const api = await standIn(200, geminiReply('{"slotId":"1:2026-11-24:3","reason":"ok"}'));
    const client = createModelClient({ apiKey: 'test-key', model: 'gemini-3.5-flash-lite', baseURL: api.url });
    const reply = await client.complete({ system: 'S', prompt: 'P' });
    await api.close();

    expect(reply).toEqual({ stopReason: 'end_turn', text: '{"slotId":"1:2026-11-24:3","reason":"ok"}' });
    expect(api.received[0].path).toBe('/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(api.received[0].key).toBe('test-key');
    expect(api.received[0].path).not.toContain('test-key');
    expect(api.received[0].body).toEqual({
      systemInstruction: { parts: [{ text: 'S' }] },
      contents: [{ role: 'user', parts: [{ text: 'P' }] }],
      generationConfig: { maxOutputTokens: 200, responseMimeType: 'application/json' },
    });
  });

  test('a reply cut off at the cap, a refusal and a blocked prompt come back as max_tokens, safety and blocked', async () => {
    for (const [body, stopReason] of [
      [geminiReply('{"slotId": "1:20', 'MAX_TOKENS'), 'max_tokens'],
      [geminiReply('', 'SAFETY'), 'safety'],
      [{ promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
      [{ candidates: [{ finishReason: 'OTHER' }] }, 'other'],
    ]) {
      const api = await standIn(200, body);
      const reply = await createModelClient({ apiKey: 'test-key', baseURL: api.url }).complete({ system: 'S', prompt: 'P' });
      await api.close();
      expect(reply.stopReason).toBe(stopReason);
    }
  });

  test('parts without text (a function call, a thought) are skipped, so only the answer text is read', async () => {
    const api = await standIn(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'x' } }, { text: '{"ok":' }, { text: 'true}' }] }, finishReason: 'STOP' }] });
    const reply = await createModelClient({ apiKey: 'test-key', baseURL: api.url }).complete({ system: 'S', prompt: 'P' });
    await api.close();
    expect(reply).toEqual({ stopReason: 'end_turn', text: '{"ok":true}' });
  });

  test('AC-18 a 429 from the API (the shared free-tier quota) reaches the service as a 429, with no retry', async () => {
    const api = await standIn(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } });
    const client = createModelClient({ apiKey: 'test-key', baseURL: api.url });
    expect(await ask(client)).toEqual({ suggestion: null, message: FALLBACK });
    await api.close();
    expect(api.received).toHaveLength(1);
    expect(await outcomes()).toEqual(['429']);
  });

  test('AC-18 a 503 from the API (overloaded) shows the fallback and records "503"', async () => {
    const api = await standIn(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } });
    const client = createModelClient({ apiKey: 'test-key', baseURL: api.url });
    expect(await ask(client)).toEqual({ suggestion: null, message: FALLBACK });
    await api.close();
    expect(await outcomes()).toEqual(['503']);
  });

  test('the defaults read GEMINI_API_KEY and GEMINI_MODEL, falling back to gemini-3.5-flash-lite', () => {
    const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
    try {
      process.env.GEMINI_API_KEY = 'from-env';
      delete process.env.GEMINI_MODEL;
      expect(createModelClient().model).toBe('gemini-3.5-flash-lite');
      process.env.GEMINI_MODEL = 'gemini-3.6-flash';
      expect(createModelClient().model).toBe('gemini-3.6-flash');
    } finally {
      for (const [name, value] of [['GEMINI_API_KEY', saved.key], ['GEMINI_MODEL', saved.model]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe('reading the reply, and what is logged', () => {
  const capture = () => {
    const lines = [];
    return { lines, log: (line) => lines.push(line) };
  };

  test('AC-17 an answer wrapped in a one-item array, or with the workstation name after the slot id, is still read', async () => {
    const slotId = `${ws.NL03}:${TUE}:4`;
    for (const reply of [
      answer([{ slotId, reason: 'Quiet with two monitors.' }]),
      answer({ slotId: `${slotId} NL-03, Networks Lab`, reason: 'Quiet with two monitors.' }),
    ]) {
      const result = await ask(fakeModel(reply), undefined, capture());
      expect(result.suggestion).toMatchObject({ slotId, workstation: 'NL-03' });
    }
    expect(await outcomes()).toEqual(['ok', 'ok']);
  });

  test('AC-18 a refused answer is logged with its outcome and a category, never the request or the answer', async () => {
    const cases = [
      [answer('Here you go!'), 'suggestion: invalid (not JSON)'],
      [answer([1, 2]), 'suggestion: invalid (not a JSON object)'],
      [answer({ slotId: 'NL-03 on Thursday', reason: 'x' }), 'suggestion: invalid (no slot id in slotId)'],
      [answer({ slotId: '999:2026-11-24:3', reason: 'x' }), 'suggestion: invalid (a slot id that was not offered)'],
      [answer({ slotId: `${ws.NL01}:${TUE}:3`, reason: 'secret words in the answer'.repeat(10) }), 'suggestion: invalid (no short plain-text reason)'],
      [answer('{}', 'safety'), 'suggestion: invalid (stopped: safety)'],
      [statusError(400), 'suggestion: error (status 400)'],
      [new TypeError('fetch failed'), 'suggestion: error (TypeError)'],
      [answer({ slotId: `${ws.NL01}:${TUE}:3`, reason: 'Free.' }), 'suggestion: ok'],
    ];
    for (const [reply, line] of cases) {
      const { lines, log } = capture();
      await ask(fakeModel(reply), 'my secret request text', { log });
      expect(lines).toEqual([line]);
      expect(lines.join(' ')).not.toMatch(/secret/);
    }
  });

  test('AC-18 a slot booked while the model was thinking is logged as such', async () => {
    const slotId = `${ws.NL01}:${TUE}:3`;
    const { lines, log } = capture();
    const client = {
      model: 'fake',
      complete: async () => {
        await createBooking(db, await userByEmail(db, STUDENT2), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
        return answer({ slotId, reason: 'Free.' });
      },
    };
    await ask(client, undefined, { log });
    expect(lines).toEqual(['suggestion: invalid (the slot was booked meanwhile)']);
  });
});
