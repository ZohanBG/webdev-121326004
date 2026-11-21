// Booking and the day view through real HTTP requests. The app's clock is fixed at
// Monday 2026-11-23, 09:30 in Sofia, the same "now" as the service tests.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, startApp, login, userByEmail, workstationIds, STUDENT, STUDENT2 } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';

let db;
let app;
let ws;
let alice;
let bob;
beforeEach(async () => {
  db = await freshDb();
  app = await startApp(db, { now: () => NOW });
  ws = await workstationIds(db);
  alice = (await login(app.base, STUDENT)).cookie;
  bob = (await login(app.base, STUDENT2)).cookie;
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const post = (cookie, body) => fetch(`${app.base}/api/bookings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const del = (cookie, id) => fetch(`${app.base}/api/bookings/${id}`, { method: 'DELETE', headers: cookie ? { cookie } : {} });
const get = (cookie, path) => fetch(`${app.base}${path}`, { headers: cookie ? { cookie } : {} });
const count = async () => (await db.query("SELECT count(*)::int AS n FROM bookings WHERE status = 'active'")).rows[0].n;

describe('POST /api/bookings', () => {
  test('AC-2 a student who books a free block gets 201, sees it in their bookings, and one active row appears', async () => {
    const res = await post(alice, { workstationId: ws.NL01, date: TUE, block: 3 });
    expect(res.status).toBe(201);
    const booking = await res.json();
    expect(booking).toMatchObject({ workstationId: ws.NL01, date: TUE, block: 3, status: 'active' });

    const mine = await (await get(alice, '/api/bookings')).json();
    expect(mine).toEqual([expect.objectContaining({ id: booking.id, date: TUE, block: 3, workstation: 'NL-01', lab: 'Networks Lab' })]);
    const { rows } = await db.query("SELECT user_id FROM bookings WHERE workstation_id = $1 AND date = $2 AND block = 3 AND status = 'active'", [ws.NL01, TUE]);
    expect(rows).toEqual([{ user_id: (await userByEmail(db, STUDENT)).id }]);
  });

  test('AC-3 two students booking the same block at the same moment: one 201, one 409 "just booked", one row', async () => {
    const responses = await Promise.all([
      post(alice, { workstationId: ws.NL01, date: TUE, block: 3 }),
      post(bob, { workstationId: ws.NL01, date: TUE, block: 3 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect(await refused.json()).toEqual({ error: 'This workstation was just booked. Pick another slot.' });
    expect(await count()).toBe(1);
  });

  test('AC-4 a fourth upcoming booking gets 409 with the limit message and adds no row', async () => {
    for (const [date, block] of [[TUE, 2], [TUE, 3], [WED, 2]]) {
      expect((await post(alice, { workstationId: ws.NL01, date, block })).status).toBe(201);
    }
    const res = await post(alice, { workstationId: ws.NL01, date: WED, block: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'You already have 3 upcoming bookings. Cancel one first.' });
    expect(await count()).toBe(3);
  });

  test('AC-5 a second workstation in a block the student already holds gets 409', async () => {
    await post(alice, { workstationId: ws.NL01, date: TUE, block: 3 });
    const res = await post(alice, { workstationId: ws.NL02, date: TUE, block: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'You already have a booking at this time.' });
  });

  test('AC-6 a started block, a weekend or a date more than 14 days ahead gets 400 with a reason and no row', async () => {
    for (const [date, block, error] of [
      [MON, 1, 'That block has already started. Pick a later one.'],
      ['2026-11-28', 3, 'Labs can be booked Monday to Friday only.'],
      ['2026-12-08', 3, 'Bookings open 14 days ahead. Pick an earlier date.'],
    ]) {
      const res = await post(alice, { workstationId: ws.NL01, date, block });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(await count()).toBe(0);
  });

  test('AC-36 a missing or malformed field gets 400 with a sentence naming the field, and no row', async () => {
    for (const [body, error] of [
      [{ date: TUE, block: 3 }, 'workstationId must be a whole number.'],
      [{ workstationId: ws.NL01, date: 'next tuesday', block: 3 }, 'date must be a real date written as YYYY-MM-DD.'],
      [{ workstationId: ws.NL01, date: TUE, block: 9 }, 'block must be a number from 1 to 6.'],
      [{ workstationId: ws.NL01, date: TUE, block: '3' }, 'block must be a number from 1 to 6.'],
    ]) {
      const res = await post(alice, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    const broken = await post(alice, '{"workstationId": 1,');
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: 'The request body is not valid JSON.' });
    expect(await count()).toBe(0);
  });

  test('AC-34 a workstation id that does not exist gets 404 "That slot does not exist." and no row', async () => {
    const res = await post(alice, { workstationId: 9999, date: TUE, block: 3 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'That slot does not exist.' });
    expect(await count()).toBe(0);
  });

  test('AC-33 a workstation that is out of service gets 409 and no row', async () => {
    const res = await post(alice, { workstationId: ws.NL04, date: TUE, block: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This workstation is out of service.' });
    expect(await count()).toBe(0);
  });
});

describe('DELETE /api/bookings/:id', () => {
  test('AC-7 cancelling your own booking gets 204; it leaves your bookings, the row is cancelled and the block is Free again', async () => {
    const booking = await (await post(alice, { workstationId: ws.NL01, date: TUE, block: 3 })).json();
    const res = await del(alice, booking.id);
    expect(res.status).toBe(204);

    expect(await (await get(alice, '/api/bookings')).json()).toEqual([]);
    const { rows } = await db.query('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    expect(rows[0].status).toBe('cancelled');
    const day = await (await get(alice, `/api/slots?date=${TUE}`)).json();
    const nl01 = day.labs.flatMap((l) => l.workstations).find((w) => w.label === 'NL-01');
    expect(nl01.blocks[2].state).toBe('free');
  });

  test('AC-35 cancelling a booking that is already cancelled gets 409', async () => {
    const booking = await (await post(alice, { workstationId: ws.NL01, date: TUE, block: 3 })).json();
    await del(alice, booking.id);
    const res = await del(alice, booking.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This booking is already cancelled.' });
  });

  test('AC-38 a booking id that does not exist gets 404', async () => {
    for (const id of ['9999', 'abc']) {
      const res = await del(alice, id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'That booking does not exist.' });
    }
  });
});

describe('GET /api/slots', () => {
  test('AC-1 the day view for a weekday shows each active workstation with its features and six blocks', async () => {
    await post(bob, { workstationId: ws.NL01, date: MON, block: 3 });
    await post(alice, { workstationId: ws.NL02, date: MON, block: 4 });
    const res = await get(alice, `/api/slots?date=${MON}`);
    expect(res.status).toBe(200);
    const day = await res.json();
    const all = day.labs.flatMap((l) => l.workstations);
    expect(all.map((w) => w.label)).toEqual(['GL-01', 'GL-02', 'NL-01', 'NL-02', 'NL-03']);
    expect(all.find((w) => w.label === 'GL-02').features).toEqual(['gpu', 'dual-monitor']);
    expect(all.find((w) => w.label === 'NL-01').blocks.map((b) => b.state)).toEqual(['past', 'free', 'taken', 'free', 'free', 'free']);
    expect(all.find((w) => w.label === 'NL-02').blocks.map((b) => b.state)).toEqual(['past', 'free', 'free', 'yours', 'free', 'free']);
    expect(JSON.stringify(day)).not.toContain('student2@labspot.test');
  });

  test('AC-1 a weekend or a missing date gets 400 with a reason', async () => {
    const weekend = await get(alice, '/api/slots?date=2026-11-28');
    expect(weekend.status).toBe(400);
    expect(await weekend.json()).toEqual({ error: 'Labs can be booked Monday to Friday only.' });
    const missing = await get(alice, '/api/slots');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'date must be a real date written as YYYY-MM-DD.' });
  });
});
