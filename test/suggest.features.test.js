// The features the model claims in its answer (AC-41), with a fake model client.
// "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { suggestSlot, FALLBACK } from '../src/services/suggest.js';
import { freshDb, userByEmail, workstationIds, STUDENT } from './helpers.js';

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

/** A fake model that answers with `data` as JSON, and records what it was asked. */
function fakeModel(data) {
  const calls = [];
  return { calls, model: 'fake', complete: async (request) => { calls.push(request); return { stopReason: 'end_turn', text: JSON.stringify(data) }; } };
}
const ask = (client, log = () => {}) => suggestSlot(db, student, { text: 'quiet place with two monitors' }, { client, now: NOW, log });
const outcomes = async () => (await db.query('SELECT outcome FROM suggestion_requests ORDER BY id')).rows.map((r) => r.outcome);
const bookingRows = async () => (await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n;
const nl03 = () => `${ws.NL03}:${TUE}:4`;

describe('the features the model claims', () => {
  test('AC-41 feature ids that the workstation really has are accepted and returned as matched; an empty list is fine', async () => {
    const result = await ask(fakeModel({ slotId: nl03(), features: ['quiet', 'dual-monitor'], reason: 'Quiet with two monitors.' }));
    expect(result.suggestion).toMatchObject({ matched: ['quiet', 'dual-monitor'], features: ['quiet', 'dual-monitor', 'linux', 'windows'] });
    const empty = await ask(fakeModel({ slotId: nl03(), features: [], reason: 'Free on Tuesday.' }));
    expect(empty.suggestion).toMatchObject({ matched: [] });
    expect(await outcomes()).toEqual(['ok', 'ok']);
  });

  test('AC-41 a feature id that is not on the list gives the fallback, outcome invalid, and no booking', async () => {
    const lines = [];
    const result = await ask(fakeModel({ slotId: nl03(), features: ['quiet', 'laser'], reason: 'Quiet.' }), (l) => lines.push(l));
    expect(result).toEqual({ suggestion: null, message: FALLBACK });
    expect(await outcomes()).toEqual(['invalid']);
    expect(await bookingRows()).toBe(0);
    expect(lines).toEqual(['suggestion: invalid (a feature id that is not on the list)']);
  });

  test('AC-41 a real feature id that the suggested workstation does not have gives the fallback, outcome invalid, and no booking', async () => {
    const lines = [];
    const result = await ask(fakeModel({ slotId: nl03(), features: ['quiet', 'gpu-cuda'], reason: 'Quiet with a GPU.' }), (l) => lines.push(l));
    expect(result).toEqual({ suggestion: null, message: FALLBACK });
    expect(await outcomes()).toEqual(['invalid']);
    expect(await bookingRows()).toBe(0);
    expect(lines).toEqual(['suggestion: invalid (a feature the workstation does not have)']);
  });

  test('AC-41 features that is not a list is refused as invalid', async () => {
    const lines = [];
    expect(await ask(fakeModel({ slotId: nl03(), features: 'quiet', reason: 'Quiet.' }), (l) => lines.push(l)))
      .toEqual({ suggestion: null, message: FALLBACK });
    expect(lines).toEqual(['suggestion: invalid (features is not a list)']);
  });

  test('AC-41 the prompt names each feature by its label, and the instructions give the model every id to answer with', async () => {
    const client = fakeModel({ slotId: nl03(), features: [], reason: 'Free.' });
    await ask(client);
    const { system, prompt } = client.calls[0];
    expect(prompt).toContain(`${ws.NL03}:${TUE}:4 NL-03, Networks Lab (Quiet zone, Dual monitors, Linux, Windows)`);
    expect(prompt).not.toContain('(quiet, dual-monitor');
    expect(system).toContain('gpu-cuda = NVIDIA GPU (CUDA)');
    expect(system).toContain('"features": [');
  });
});
