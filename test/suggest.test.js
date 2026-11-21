// The suggestion endpoint through real HTTP requests, with a fake model client. "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, afterEach } from 'vitest';
import { freshDb, startApp, login, workstationIds, STUDENT, STAFF } from './helpers.js';
import { FALLBACK, LIMIT_REACHED } from '../src/services/suggest.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const TUE = '2026-11-24';

let db;
let app;
afterEach(async () => {
  await app.close();
  await db.close();
});

async function start(model) {
  db = await freshDb();
  app = await startApp(db, { now: () => NOW, model });
  return workstationIds(db);
}
const suggest = (cookie, body) => fetch(`${app.base}/api/suggestions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});
const reply = (data) => ({ model: 'fake', complete: async () => ({ stopReason: 'end_turn', text: JSON.stringify(data) }) });

describe('POST /api/suggestions', () => {
  test('AC-17 a student gets a suggestion with a reason; nothing is booked until they press Book', async () => {
    let ws;
    const model = { model: 'fake', complete: async () => ({ stopReason: 'end_turn', text: JSON.stringify({ slotId: `${ws.NL03}:${TUE}:4`, reason: 'Quiet, two monitors.' }) }) };
    ws = await start(model);
    const { cookie } = await login(app.base, STUDENT);
    const res = await suggest(cookie, { text: 'quiet with two monitors on Tuesday afternoon' });
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion).toMatchObject({ workstation: 'NL-03', date: TUE, block: 4, reason: 'Quiet, two monitors.' });
    expect((await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n).toBe(0);
  });

  test('AC-18 with no model key the student gets the fallback message and the day view still works', async () => {
    await start(null);
    const { cookie } = await login(app.base, STUDENT);
    const res = await suggest(cookie, { text: 'anything on Tuesday' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: null, message: FALLBACK });
    expect((await fetch(`${app.base}/api/slots?date=${TUE}`, { headers: { cookie } })).status).toBe(200);
  });

  test("AC-29 the eleventh request of the day gets the limit message", async () => {
    await start(reply({ slotId: 'x', reason: 'x' }));
    const { cookie } = await login(app.base, STUDENT);
    await db.query(`INSERT INTO suggestion_requests (user_id, created_at, outcome)
                    SELECT id, $1, 'ok' FROM users, generate_series(1, 10) WHERE email = $2`, [NOW, STUDENT]);
    expect(await (await suggest(cookie, { text: 'anything' })).json()).toEqual({ suggestion: null, message: LIMIT_REACHED });
  });

  test('an empty request gets 400, staff get 403, and a visitor gets 401', async () => {
    await start(reply({}));
    const student = (await login(app.base, STUDENT)).cookie;
    const empty = await suggest(student, { text: '' });
    expect(empty.status).toBe(400);
    expect((await suggest((await login(app.base, STAFF)).cookie, { text: 'x' })).status).toBe(403);
    expect((await suggest(null, { text: 'x' })).status).toBe(401);
  });
});
