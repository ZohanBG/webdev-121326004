// Staff screens and endpoints through real HTTP requests. "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, startApp, login, userByEmail, workstationIds, STUDENT, STAFF } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const TUE = '2026-11-24';

let db;
let app;
let ws;
let student;
let staff;
beforeEach(async () => {
  db = await freshDb();
  app = await startApp(db, { now: () => NOW });
  ws = await workstationIds(db);
  student = (await login(app.base, STUDENT)).cookie;
  staff = (await login(app.base, STAFF)).cookie;
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const send = (cookie, method, path, body) => fetch(`${app.base}${path}`, {
  method,
  redirect: 'manual',
  headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const projectRoom = async () => (await db.query("SELECT id FROM labs WHERE name = 'Project Room'")).rows[0].id;

describe('labs', () => {
  test('AC-10 a student who opens /staff/labs or calls POST /api/labs gets 403, and no row is added to labs', async () => {
    const page = await send(student, 'GET', '/staff/labs');
    expect(page.status).toBe(403);
    expect(await page.text()).toContain('Only lab staff can open this page.');
    const api = await send(student, 'POST', '/api/labs', { name: 'Robotics', room: '4101' });
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: 'Only lab staff can do this.' });
    expect(await count('labs')).toBe(3);
  });

  test('AC-11 a staff member who adds a lab gets 201, the lab shows in /api/labs, and a new row appears', async () => {
    const res = await send(staff, 'POST', '/api/labs', { name: 'Robotics', room: '4101' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Robotics', room: '4101' });
    const labs = await (await send(student, 'GET', '/api/labs')).json();
    expect(labs.map((l) => l.name)).toContain('Robotics');
    expect(await count('labs')).toBe(4);
  });

  test('GET /api/admin/labs lists every workstation for staff, including out of service, and is 403 for a student', async () => {
    const res = await send(staff, 'GET', '/api/admin/labs');
    expect(res.status).toBe(200);
    const labs = await res.json();
    expect(labs.find((l) => l.name === 'Networks Lab').workstations.map((w) => w.label)).toEqual(['NL-01', 'NL-02', 'NL-03', 'NL-04']);
    expect((await send(student, 'GET', '/api/admin/labs')).status).toBe(403);
  });

  test('the staff pages open for staff and send a visitor to /login', async () => {
    for (const path of ['/staff/labs', '/staff/bookings']) {
      expect((await send(staff, 'GET', path)).status).toBe(200);
      const visitor = await send(null, 'GET', path);
      expect(visitor.status).toBe(302);
      expect(visitor.headers.get('location')).toBe('/login');
    }
    expect((await send(student, 'GET', '/staff/bookings')).status).toBe(403);
  });
});

describe('workstations', () => {
  test('AC-12 a staff member who adds a workstation with quiet and dual-monitor sees them in the day view', async () => {
    const res = await send(staff, 'POST', '/api/workstations', { labId: await projectRoom(), label: 'PR-01', features: ['quiet', 'dual-monitor'] });
    expect(res.status).toBe(201);
    const day = await (await send(staff, 'GET', `/api/slots?date=${TUE}`)).json();
    const pr01 = day.labs.find((l) => l.name === 'Project Room').workstations[0];
    expect(pr01).toMatchObject({ label: 'PR-01', features: ['quiet', 'dual-monitor'] });
  });

  test('AC-12 a feature outside the fixed list gets 400 and adds no row', async () => {
    const res = await send(staff, 'POST', '/api/workstations', { labId: await projectRoom(), label: 'PR-01', features: ['laser'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'features may only contain quiet, dual-monitor and gpu.' });
    expect(await count('workstations')).toBe(6);
  });

  test('AC-13 a workstation with no upcoming bookings taken out of service is no longer offered in the day view', async () => {
    const res = await send(staff, 'PATCH', `/api/workstations/${ws.NL01}`, { inService: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inService: false });
    const day = await (await send(student, 'GET', `/api/slots?date=${TUE}`)).json();
    expect(day.labs.flatMap((l) => l.workstations).map((w) => w.label)).not.toContain('NL-01');
  });

  test('AC-13 a workstation with upcoming bookings is refused with 409 "Cancel its N upcoming booking(s) first." and stays in service', async () => {
    await send(student, 'POST', '/api/bookings', { workstationId: ws.NL01, date: TUE, block: 3 });
    const res = await send(staff, 'PATCH', `/api/workstations/${ws.NL01}`, { inService: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Cancel its 1 upcoming booking first.' });
    const { rows } = await db.query('SELECT in_service FROM workstations WHERE id = $1', [ws.NL01]);
    expect(rows[0].in_service).toBe(true);
  });
});

describe('all bookings', () => {
  test("AC-14 a staff member who opens all bookings for a day sees every active booking with the student's email", async () => {
    await send(student, 'POST', '/api/bookings', { workstationId: ws.NL01, date: TUE, block: 3 });
    const res = await send(staff, 'GET', `/api/admin/bookings?date=${TUE}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([expect.objectContaining({ workstation: 'NL-01', lab: 'Networks Lab', block: 3, email: STUDENT })]);
  });

  test('AC-15 a student who calls GET /api/admin/bookings gets 403 and no booking data', async () => {
    await send(student, 'POST', '/api/bookings', { workstationId: ws.NL01, date: TUE, block: 3 });
    const res = await send(student, 'GET', `/api/admin/bookings?date=${TUE}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Only lab staff can do this.' });
  });

  test("AC-28 a staff member who cancels a student's booking gets 204; cancelled_by is the staff id and the student sees it marked", async () => {
    const booking = await (await send(student, 'POST', '/api/bookings', { workstationId: ws.NL01, date: TUE, block: 3 })).json();
    const res = await send(staff, 'DELETE', `/api/bookings/${booking.id}`);
    expect(res.status).toBe(204);
    const { rows } = await db.query('SELECT status, cancelled_by FROM bookings WHERE id = $1', [booking.id]);
    expect(rows[0]).toEqual({ status: 'cancelled', cancelled_by: (await userByEmail(db, STAFF)).id });
    const mine = await (await send(student, 'GET', '/api/bookings')).json();
    expect(mine).toEqual([expect.objectContaining({ id: booking.id, cancelledByStaff: true })]);
  });
});
