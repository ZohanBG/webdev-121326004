// The booking rules, called directly on the service: no HTTP involved.
// "Now" is fixed: Monday 2026-11-23, 09:30 in Sofia. Block 1 (08:00) has started, block 2 (10:00) has not.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBooking, cancelBooking, listDay, listMine } from '../src/services/bookings.js';
import { freshDb, userByEmail, workstationIds, STUDENT, STUDENT2, STAFF } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';

let db;
let student;
let student2;
let staff;
let ws;
beforeEach(async () => {
  db = await freshDb();
  student = await userByEmail(db, STUDENT);
  student2 = await userByEmail(db, STUDENT2);
  staff = await userByEmail(db, STAFF);
  ws = await workstationIds(db);
});
afterEach(async () => {
  await db.close();
});

const slot = (workstationId, date, block) => ({ workstationId, date, block });
const book = (user, workstationId, date, block) => createBooking(db, user, slot(workstationId, date, block), NOW);
const rows = async () =>
  (await db.query("SELECT id, user_id, workstation_id, to_char(date, 'YYYY-MM-DD') AS date, block, status, cancelled_by FROM bookings ORDER BY id")).rows;

/**
 * A database whose transactions let a competing request insert its booking right before ours,
 * as two requests on a real server can. Our pre-checks have already passed, so only the
 * unique index can refuse the second insert.
 */
function withCompetitor(target, competitor) {
  const bind = (obj, prop) => (typeof obj[prop] === 'function' ? obj[prop].bind(obj) : obj[prop]);
  return new Proxy(target, {
    get(dbTarget, prop) {
      if (prop !== 'transaction') return bind(dbTarget, prop);
      return (fn) => dbTarget.transaction((tx) => fn(new Proxy(tx, {
        get(txTarget, txProp) {
          if (txProp !== 'query') return bind(txTarget, txProp);
          return async (text, params) => {
            if (/^INSERT INTO bookings/.test(text)) {
              await txTarget.query('INSERT INTO bookings (user_id, workstation_id, date, block) VALUES ($1, $2, $3, $4)', competitor);
            }
            return txTarget.query(text, params);
          };
        },
      })));
    },
  });
}

describe('createBooking', () => {
  test('AC-2 booking a free upcoming block adds exactly one active row for that workstation, date and block', async () => {
    const booking = await book(student, ws.NL01, TUE, 3);
    expect(booking).toMatchObject({ userId: student.id, workstationId: ws.NL01, date: TUE, block: 3, status: 'active' });
    expect(await rows()).toEqual([expect.objectContaining({ user_id: student.id, workstation_id: ws.NL01, date: TUE, block: 3, status: 'active' })]);
  });

  test('AC-3 when two students book the same block at the same moment, one gets it and the other is told it was just booked', async () => {
    const results = await Promise.allSettled([book(student, ws.NL01, TUE, 3), book(student2, ws.NL01, TUE, 3)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason)
      .toMatchObject({ name: 'Conflict', message: 'This workstation was just booked. Pick another slot.' });
    expect((await rows()).filter((r) => r.status === 'active')).toHaveLength(1);
  });

  test('AC-3 a clash on the workstation index during the insert is reported as "just booked", not as a server error', async () => {
    const racing = withCompetitor(db, [student2.id, ws.NL01, TUE, 3]);
    await expect(createBooking(racing, student, slot(ws.NL01, TUE, 3), NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'This workstation was just booked. Pick another slot.' });
    expect(await rows()).toEqual([]);
  });

  test('AC-5 a clash on the student index during the insert is reported as "already have a booking at this time"', async () => {
    const racing = withCompetitor(db, [student.id, ws.NL02, TUE, 3]);
    await expect(createBooking(racing, student, slot(ws.NL01, TUE, 3), NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'You already have a booking at this time.' });
    expect(await rows()).toEqual([]);
  });

  test('AC-3 a block someone else already holds is refused with the same message', async () => {
    await book(student2, ws.NL01, TUE, 3);
    await expect(book(student, ws.NL01, TUE, 3))
      .rejects.toMatchObject({ name: 'Conflict', message: 'This workstation was just booked. Pick another slot.' });
  });

  test('AC-4 a student with 3 upcoming active bookings cannot make a fourth, and no row is added', async () => {
    await book(student, ws.NL01, TUE, 2);
    await book(student, ws.NL01, TUE, 3);
    await book(student, ws.NL01, WED, 2);
    await expect(book(student, ws.NL01, THU, 2))
      .rejects.toMatchObject({ name: 'Conflict', message: 'You already have 3 upcoming bookings. Cancel one first.' });
    expect(await rows()).toHaveLength(3);
  });

  test('AC-4 cancelled bookings and blocks that have started do not count towards the limit', async () => {
    const first = await book(student, ws.NL01, TUE, 2);
    await cancelBooking(db, student, first.id, NOW);
    await book(student, ws.NL01, TUE, 3);
    await book(student, ws.NL01, WED, 2);
    // a booking from an earlier day that has started already
    await db.query('INSERT INTO bookings (user_id, workstation_id, date, block) VALUES ($1, $2, $3, 1)', [student.id, ws.NL02, MON]);
    await expect(book(student, ws.NL01, THU, 2)).resolves.toMatchObject({ status: 'active' });
  });

  test('AC-5 a student who already has a booking in a block cannot book another workstation in it', async () => {
    await book(student, ws.NL01, TUE, 3);
    await expect(book(student, ws.NL02, TUE, 3))
      .rejects.toMatchObject({ name: 'Conflict', message: 'You already have a booking at this time.' });
    expect(await rows()).toHaveLength(1);
  });

  test('AC-6 a block that has started, a weekend and a date more than 14 days ahead are refused with a readable reason', async () => {
    await expect(book(student, ws.NL01, MON, 1)).rejects.toMatchObject({ name: 'InvalidInput', message: 'That block has already started. Pick a later one.' });
    await expect(book(student, ws.NL01, '2026-11-20', 4)).rejects.toMatchObject({ name: 'InvalidInput', message: 'That block has already started. Pick a later one.' });
    await expect(book(student, ws.NL01, '2026-11-28', 3)).rejects.toMatchObject({ name: 'InvalidInput', message: 'Labs can be booked Monday to Friday only.' });
    await expect(book(student, ws.NL01, '2026-12-08', 3)).rejects.toMatchObject({ name: 'InvalidInput', message: 'Bookings open 14 days ahead. Pick an earlier date.' });
    expect(await rows()).toEqual([]);
    // the edges are allowed: the next block today, and exactly 14 days ahead
    await expect(book(student, ws.NL01, MON, 2)).resolves.toMatchObject({ status: 'active' });
    await expect(book(student, ws.NL02, '2026-12-07', 2)).resolves.toMatchObject({ status: 'active' });
  });

  test('AC-36 a missing or malformed field is refused with a sentence naming the field', async () => {
    const cases = [
      [{ date: TUE, block: 3 }, 'workstationId must be a whole number.'],
      [{ workstationId: 'seven', date: TUE, block: 3 }, 'workstationId must be a whole number.'],
      [{ workstationId: 1.5, date: TUE, block: 3 }, 'workstationId must be a whole number.'],
      [{ workstationId: ws.NL01, block: 3 }, 'date must be a real date written as YYYY-MM-DD.'],
      [{ workstationId: ws.NL01, date: '2026-02-30', block: 3 }, 'date must be a real date written as YYYY-MM-DD.'],
      [{ workstationId: ws.NL01, date: '24.11.2026', block: 3 }, 'date must be a real date written as YYYY-MM-DD.'],
      [{ workstationId: ws.NL01, date: TUE }, 'block must be a number from 1 to 6.'],
      [{ workstationId: ws.NL01, date: TUE, block: 7 }, 'block must be a number from 1 to 6.'],
      [{ workstationId: ws.NL01, date: TUE, block: 'three' }, 'block must be a number from 1 to 6.'],
    ];
    for (const [input, message] of cases) {
      await expect(createBooking(db, student, input, NOW)).rejects.toMatchObject({ name: 'InvalidInput', message });
    }
    await expect(createBooking(db, student, undefined, NOW)).rejects.toMatchObject({ name: 'InvalidInput' });
    expect(await rows()).toEqual([]);
  });

  test('AC-34 a well-formed slot on a workstation that does not exist is NotFound, and no row is added', async () => {
    await expect(book(student, 9999, TUE, 3)).rejects.toMatchObject({ name: 'NotFound', message: 'That slot does not exist.' });
    expect(await rows()).toEqual([]);
  });

  test('AC-33 a workstation that is out of service cannot be booked', async () => {
    await expect(book(student, ws.NL04, TUE, 3)).rejects.toMatchObject({ name: 'Conflict', message: 'This workstation is out of service.' });
    expect(await rows()).toEqual([]);
  });

  test('AC-16 a staff account cannot book a workstation', async () => {
    await expect(book(staff, ws.NL01, TUE, 3)).rejects.toMatchObject({ name: 'Forbidden', message: 'Staff accounts cannot book workstations.' });
    expect(await rows()).toEqual([]);
  });

  test('AC-32 a caller with no user cannot book', async () => {
    await expect(book(null, ws.NL01, TUE, 3)).rejects.toMatchObject({ name: 'NotSignedIn' });
  });
});

describe('cancelBooking', () => {
  test('AC-7 cancelling your own upcoming booking marks it cancelled, records who did it, and frees the block', async () => {
    const booking = await book(student, ws.NL01, TUE, 3);
    const cancelled = await cancelBooking(db, student, booking.id, NOW);
    expect(cancelled).toMatchObject({ id: booking.id, status: 'cancelled' });
    expect(await rows()).toEqual([expect.objectContaining({ id: booking.id, status: 'cancelled', cancelled_by: student.id })]);
    await expect(book(student2, ws.NL01, TUE, 3)).resolves.toMatchObject({ status: 'active' });
  });

  test('AC-38 a booking id that does not exist is NotFound', async () => {
    for (const id of [9999, '9999', 'abc', -1, undefined]) {
      await expect(cancelBooking(db, student, id, NOW)).rejects.toMatchObject({ name: 'NotFound', message: 'That booking does not exist.' });
    }
  });

  test("AC-9 a student cannot cancel another student's booking, and the row stays active", async () => {
    const booking = await book(student2, ws.NL01, TUE, 3);
    await expect(cancelBooking(db, student, booking.id, NOW))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'You can only cancel your own bookings.' });
    expect((await rows())[0]).toMatchObject({ status: 'active', cancelled_by: null });
  });

  test('AC-35 cancelling a booking that is already cancelled is refused, and the row does not change', async () => {
    const booking = await book(student, ws.NL01, TUE, 3);
    await cancelBooking(db, student, booking.id, NOW);
    const before = await rows();
    await expect(cancelBooking(db, student, booking.id, NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'This booking is already cancelled.' });
    expect(await rows()).toEqual(before);
  });

  test('AC-35 a booking cancelled by a parallel request between the check and the update is reported as already cancelled', async () => {
    const booking = await book(student, ws.NL01, TUE, 3);
    // the other request's UPDATE lands just before ours
    const racing = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'query') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        return async (text, params) => {
          if (/^UPDATE bookings/.test(text)) {
            await target.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2 WHERE id = $1", [booking.id, student.id]);
          }
          return target.query(text, params);
        };
      },
    });
    await expect(cancelBooking(racing, student, booking.id, NOW))
      .rejects.toMatchObject({ name: 'Conflict', message: 'This booking is already cancelled.' });
  });

  test('AC-8 a booking whose block has started cannot be cancelled', async () => {
    const booking = await book(student, ws.NL01, MON, 2);
    const later = new Date('2026-11-23T08:30:00Z'); // 10:30 in Sofia, block 2 is under way
    await expect(cancelBooking(db, student, booking.id, later))
      .rejects.toMatchObject({ name: 'Conflict', message: 'This booking has already started.' });
    expect((await rows())[0]).toMatchObject({ status: 'active' });
  });

  test('AC-37 a caller with no user cannot cancel', async () => {
    const booking = await book(student, ws.NL01, TUE, 3);
    await expect(cancelBooking(db, null, booking.id, NOW)).rejects.toMatchObject({ name: 'NotSignedIn' });
  });
});

describe('listDay and listMine', () => {
  test('AC-1 the day view lists every active workstation with its features and six blocks marked free, taken, yours or past', async () => {
    await book(student, ws.NL01, MON, 2);
    await book(student2, ws.NL02, MON, 3);
    const day = await listDay(db, student, MON, NOW);

    expect(day.date).toBe(MON);
    const labels = day.labs.flatMap((lab) => lab.workstations.map((w) => w.label));
    expect(labels).toEqual(['GL-01', 'GL-02', 'NL-01', 'NL-02', 'NL-03']); // NL-04 is out of service
    const nl01 = day.labs.find((l) => l.name === 'Networks Lab').workstations.find((w) => w.label === 'NL-01');
    expect(nl01.features).toEqual(['quiet']);
    expect(nl01.blocks.map((b) => b.state)).toEqual(['past', 'yours', 'free', 'free', 'free', 'free']);
    expect(nl01.blocks[1]).toMatchObject({ block: 2, start: '10:00', end: '12:00' });
    expect(typeof nl01.blocks[1].bookingId).toBe('number');
    const nl02 = day.labs.find((l) => l.name === 'Networks Lab').workstations.find((w) => w.label === 'NL-02');
    expect(nl02.blocks[2]).toEqual({ block: 3, start: '12:00', end: '14:00', state: 'taken' }); // no name or booking id of the other student
  });

  test('AC-1 the day view refuses a weekend, a past day, a day too far ahead and a malformed date', async () => {
    await expect(listDay(db, student, '2026-11-28', NOW)).rejects.toMatchObject({ name: 'InvalidInput', message: 'Labs can be booked Monday to Friday only.' });
    await expect(listDay(db, student, '2026-11-20', NOW)).rejects.toMatchObject({ name: 'InvalidInput', message: 'That day has passed. Pick today or a later day.' });
    await expect(listDay(db, student, '2026-12-08', NOW)).rejects.toMatchObject({ name: 'InvalidInput', message: 'Bookings open 14 days ahead. Pick an earlier date.' });
    await expect(listDay(db, student, 'tomorrow', NOW)).rejects.toMatchObject({ name: 'InvalidInput', message: 'date must be a real date written as YYYY-MM-DD.' });
    await expect(listDay(db, null, MON, NOW)).rejects.toMatchObject({ name: 'NotSignedIn' });
  });

  test('AC-7 my bookings lists only my upcoming active bookings, soonest first', async () => {
    await book(student, ws.NL01, WED, 2);
    const cancelled = await book(student, ws.NL01, TUE, 4);
    await cancelBooking(db, student, cancelled.id, NOW);
    await book(student, ws.GL01, TUE, 2);
    await book(student2, ws.NL02, TUE, 2);
    await db.query('INSERT INTO bookings (user_id, workstation_id, date, block) VALUES ($1, $2, $3, 1)', [student.id, ws.NL03, MON]); // started

    const mine = await listMine(db, student, NOW);
    expect(mine.map((b) => [b.date, b.block, b.lab, b.workstation, b.start, b.end])).toEqual([
      [TUE, 2, 'GPU Lab', 'GL-01', '10:00', '12:00'],
      [WED, 2, 'Networks Lab', 'NL-01', '10:00', '12:00'],
    ]);
    await expect(listMine(db, null, NOW)).rejects.toMatchObject({ name: 'NotSignedIn' });
  });
});
