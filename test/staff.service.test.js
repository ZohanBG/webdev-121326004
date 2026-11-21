// Staff rules, called directly on the services. "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { addLab, listLabs, listLabsForStaff } from '../src/services/labs.js';
import { addWorkstation, updateWorkstation } from '../src/services/workstations.js';
import { createBooking, cancelBooking, listDay, listMine, listAllForDay } from '../src/services/bookings.js';
import { freshDb, userByEmail, workstationIds, STUDENT, STAFF } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const TUE = '2026-11-24';

let db;
let student;
let staff;
let ws;
beforeEach(async () => {
  db = await freshDb();
  student = await userByEmail(db, STUDENT);
  staff = await userByEmail(db, STAFF);
  ws = await workstationIds(db);
});
afterEach(async () => {
  await db.close();
});

const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const labId = async (name) => (await db.query('SELECT id FROM labs WHERE name = $1', [name])).rows[0].id;
const labelsOn = async (date) => (await listDay(db, student, date, NOW)).labs.flatMap((l) => l.workstations.map((w) => w.label));

describe('labs', () => {
  test('AC-10 a student cannot add a lab, and no row is added', async () => {
    await expect(addLab(db, student, { name: 'Robotics', room: '4101' }))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'Only lab staff can do this.' });
    expect(await count('labs')).toBe(3);
    await expect(listLabsForStaff(db, student)).rejects.toMatchObject({ name: 'Forbidden' });
  });

  test('AC-11 a staff member who adds a lab sees it in the labs list, and a new row appears', async () => {
    const lab = await addLab(db, staff, { name: '  Robotics ', room: '4101' });
    expect(lab).toMatchObject({ name: 'Robotics', room: '4101' });
    expect((await listLabs(db, student)).map((l) => l.name)).toContain('Robotics');
    expect(await count('labs')).toBe(4);
  });

  test('AC-11 a lab needs a name and a room', async () => {
    await expect(addLab(db, staff, { room: '4101' })).rejects.toMatchObject({ name: 'InvalidInput', message: 'name is required.' });
    await expect(addLab(db, staff, { name: 'Robotics', room: ' ' })).rejects.toMatchObject({ name: 'InvalidInput', message: 'room is required.' });
    await expect(addLab(db, staff, undefined)).rejects.toMatchObject({ name: 'InvalidInput' });
    await expect(addLab(db, null, { name: 'x', room: 'y' })).rejects.toMatchObject({ name: 'NotSignedIn' });
    expect(await count('labs')).toBe(3);
  });

  test('staff see every lab with all its workstations, including those out of service', async () => {
    const labs = await listLabsForStaff(db, staff);
    const networks = labs.find((l) => l.name === 'Networks Lab');
    expect(networks.workstations.map((w) => [w.label, w.inService])).toEqual([
      ['NL-01', true], ['NL-02', true], ['NL-03', true], ['NL-04', false],
    ]);
    expect(labs.find((l) => l.name === 'Project Room').workstations).toEqual([]);
  });
});

describe('workstations', () => {
  test('AC-12 a staff member who adds a workstation with quiet and dual-monitor sees those features in the day view', async () => {
    const added = await addWorkstation(db, staff, { labId: await labId('Project Room'), label: 'PR-01', features: ['quiet', 'dual-monitor'] });
    expect(added).toMatchObject({ label: 'PR-01', features: ['quiet', 'dual-monitor'], inService: true });
    const day = await listDay(db, student, TUE, NOW);
    const pr01 = day.labs.find((l) => l.name === 'Project Room').workstations[0];
    expect(pr01).toMatchObject({ label: 'PR-01', features: ['quiet', 'dual-monitor'] });
  });

  test('AC-12 a feature outside the fixed list is refused, and no row is added', async () => {
    await expect(addWorkstation(db, staff, { labId: await labId('Project Room'), label: 'PR-01', features: ['quiet', 'laser'] }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'features may only contain quiet, dual-monitor and gpu.' });
    await expect(addWorkstation(db, staff, { labId: await labId('Project Room'), label: 'PR-01', features: 'quiet' }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'features may only contain quiet, dual-monitor and gpu.' });
    expect(await count('workstations')).toBe(6);
  });

  test('AC-12 a workstation needs a whole-number lab id of a lab that exists, and a label unique in its lab', async () => {
    await expect(addWorkstation(db, staff, { labId: 'one', label: 'X-1', features: [] }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'labId must be a whole number.' });
    await expect(addWorkstation(db, staff, { labId: await labId('Project Room'), label: '', features: [] }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'label is required.' });
    await expect(addWorkstation(db, staff, { labId: 9999, label: 'X-1', features: [] }))
      .rejects.toMatchObject({ name: 'NotFound', message: 'That lab does not exist.' });
    await expect(addWorkstation(db, staff, { labId: await labId('Networks Lab'), label: 'NL-01' }))
      .rejects.toMatchObject({ name: 'Conflict', message: 'That lab already has a workstation with this label.' });
    await expect(addWorkstation(db, student, { labId: await labId('Project Room'), label: 'X-1' })).rejects.toMatchObject({ name: 'Forbidden' });
    expect(await count('workstations')).toBe(6);
  });

  test('an unexpected database error while adding a workstation is passed on, not reported as a duplicate label', async () => {
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'query') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        return (text, params) => (/^INSERT INTO workstations/.test(text) ? Promise.reject(new Error('disk full')) : target.query(text, params));
      },
    });
    await expect(addWorkstation(failing, staff, { labId: await labId('Project Room'), label: 'PR-01' })).rejects.toThrow('disk full');
  });

  test('AC-12 staff can change the features of a workstation', async () => {
    const updated = await updateWorkstation(db, staff, ws.NL02, { features: ['gpu'] });
    expect(updated).toMatchObject({ id: ws.NL02, features: ['gpu'] });
    await expect(updateWorkstation(db, staff, ws.NL02, { features: ['fast'] })).rejects.toMatchObject({ name: 'InvalidInput' });
  });

  test('AC-13 a workstation with no upcoming bookings taken out of service is no longer offered in the day view', async () => {
    const updated = await updateWorkstation(db, staff, ws.NL01, { inService: false });
    expect(updated).toMatchObject({ inService: false });
    expect(await labelsOn(TUE)).not.toContain('NL-01');
    // and back again
    await updateWorkstation(db, staff, ws.NL01, { inService: true });
    expect(await labelsOn(TUE)).toContain('NL-01');
  });

  test('AC-13 a workstation with upcoming bookings is refused with "Cancel its N upcoming bookings first." and stays in service', async () => {
    await createBooking(db, student, { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    await expect(updateWorkstation(db, staff, ws.NL01, { inService: false }, NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'Cancel its 1 upcoming booking first.' });
    await createBooking(db, student, { workstationId: ws.NL01, date: TUE, block: 4 }, NOW);
    await expect(updateWorkstation(db, staff, ws.NL01, { inService: false }, NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'Cancel its 2 upcoming bookings first.' });
    expect(await labelsOn(TUE)).toContain('NL-01');
  });

  test('AC-13 updating needs staff, a workstation that exists, and something to change', async () => {
    await expect(updateWorkstation(db, student, ws.NL01, { inService: false })).rejects.toMatchObject({ name: 'Forbidden' });
    await expect(updateWorkstation(db, staff, 9999, { inService: false }))
      .rejects.toMatchObject({ name: 'NotFound', message: 'That workstation does not exist.' });
    await expect(updateWorkstation(db, staff, 'x', { inService: false })).rejects.toMatchObject({ name: 'NotFound' });
    await expect(updateWorkstation(db, staff, ws.NL01, { inService: 'no' }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'Send features, inService, or both.' });
    await expect(updateWorkstation(db, staff, ws.NL01, undefined)).rejects.toMatchObject({ name: 'InvalidInput' });
  });
});

describe('all bookings and staff cancelling', () => {
  test("AC-14 a staff member sees every active booking for a day with the student's email", async () => {
    await createBooking(db, student, { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    const cancelled = await createBooking(db, student, { workstationId: ws.GL01, date: TUE, block: 4 }, NOW);
    await cancelBooking(db, student, cancelled.id, NOW);

    const all = await listAllForDay(db, staff, TUE);
    expect(all).toEqual([
      expect.objectContaining({ lab: 'Networks Lab', workstation: 'NL-01', block: 3, start: '12:00', end: '14:00', email: STUDENT }),
    ]);
    await expect(listAllForDay(db, staff, 'soon')).rejects.toMatchObject({ name: 'InvalidInput' });
  });

  test('AC-15 a student cannot see all bookings', async () => {
    await expect(listAllForDay(db, student, TUE))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'Only lab staff can do this.' });
  });

  test("AC-28 a staff member who cancels a student's booking records the staff id, and the student sees it marked", async () => {
    const booking = await createBooking(db, student, { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    await cancelBooking(db, staff, booking.id, NOW);
    const { rows } = await db.query('SELECT status, cancelled_by FROM bookings WHERE id = $1', [booking.id]);
    expect(rows[0]).toEqual({ status: 'cancelled', cancelled_by: staff.id });

    const mine = await listMine(db, student, NOW);
    expect(mine).toEqual([expect.objectContaining({ id: booking.id, status: 'cancelled', cancelledByStaff: true })]);
  });
});
