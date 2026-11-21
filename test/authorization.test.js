// Authentication ("who are you?", 401) and authorization ("may you do this?", 403) for bookings.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBooking, cancelBooking } from '../src/services/bookings.js';
import { freshDb, startApp, login, workstationIds, STUDENT, STUDENT2, STAFF } from './helpers.js';

// The real service, wrapped so a test can see whether a request ever reached it.
vi.mock('../src/services/bookings.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, createBooking: vi.fn(real.createBooking), cancelBooking: vi.fn(real.cancelBooking) };
});

const NOW = new Date('2026-11-23T07:30:00Z'); // Monday 09:30 in Sofia
const TUE = '2026-11-24';

let db;
let app;
let ws;
beforeEach(async () => {
  db = await freshDb();
  app = await startApp(db, { now: () => NOW });
  ws = await workstationIds(db);
  vi.clearAllMocks();
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const book = (cookie, body) => fetch(`${app.base}/api/bookings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});
const cancel = (cookie, id) => fetch(`${app.base}/api/bookings/${id}`, { method: 'DELETE', headers: cookie ? { cookie } : {} });
const statusOf = async (id) => (await db.query('SELECT status, cancelled_by FROM bookings WHERE id = $1', [id])).rows[0];

describe('without a session: 401 before any service runs', () => {
  test('AC-32 POST /api/bookings without a session gets 401, and no row is added', async () => {
    const res = await book(null, { workstationId: ws.NL01, date: TUE, block: 3 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in first.' });
    expect(createBooking.mock.calls.length).toBe(0); // the route stopped it
    expect((await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n).toBe(0);
  });

  test('AC-37 DELETE /api/bookings/:id without a session gets 401, and the row does not change', async () => {
    const { cookie } = await login(app.base, STUDENT);
    const booking = await (await book(cookie, { workstationId: ws.NL01, date: TUE, block: 3 })).json();
    const res = await cancel(null, booking.id);
    expect(res.status).toBe(401);
    expect(cancelBooking.mock.calls.length).toBe(0);
    expect(await statusOf(booking.id)).toEqual({ status: 'active', cancelled_by: null });
  });

  test('the day view and "my bookings" are 401 without a session too', async () => {
    for (const path of [`/api/slots?date=${TUE}`, '/api/bookings']) {
      const res = await fetch(`${app.base}${path}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Sign in first.' });
    }
  });
});

describe('signed in but not allowed: 403 from the service', () => {
  test("AC-9 a student who cancels another student's booking gets 403, and the row stays active", async () => {
    const owner = (await login(app.base, STUDENT2)).cookie;
    const booking = await (await book(owner, { workstationId: ws.NL01, date: TUE, block: 3 })).json();
    const other = (await login(app.base, STUDENT)).cookie;

    const res = await cancel(other, booking.id);
    expect(res.status).toBe(403);
    expect(cancelBooking.mock.calls.length).toBe(1); // the service decided, not the route
    expect(await res.json()).toEqual({ error: 'You can only cancel your own bookings.' });
    expect(await statusOf(booking.id)).toEqual({ status: 'active', cancelled_by: null });
  });

  test('AC-16 a staff member who calls POST /api/bookings gets 403 "Staff accounts cannot book workstations." and no row', async () => {
    const { cookie } = await login(app.base, STAFF);
    const res = await book(cookie, { workstationId: ws.NL01, date: TUE, block: 3 });
    expect(res.status).toBe(403);
    expect(createBooking.mock.calls.length).toBe(1);
    expect(await res.json()).toEqual({ error: 'Staff accounts cannot book workstations.' });
    expect((await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n).toBe(0);
  });
});
