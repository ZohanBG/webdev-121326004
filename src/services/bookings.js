// The booking rules. Both front doors (HTTP routes and MCP tools) call these functions.
// `now` is passed in so tests can fix the clock; the app passes the real time.
import { transaction } from '../data/db.js';
import * as bookings from '../data/bookings.js';
import * as workstations from '../data/workstations.js';
import * as users from '../data/users.js';
import { InvalidInput, Forbidden, NotFound, Conflict } from './errors.js';
import { requireUser, requireStaff } from './access.js';
import { BLOCKS, blockTimes, bookableDates, hasStarted, isRealDate, isWeekday, lastBookableDate, today } from './time.js';

const MAX_UPCOMING = 3;

const TAKEN = 'This workstation was just booked. Pick another slot.';
const SAME_BLOCK = 'You already have a booking at this time.';
const DATE_FORMAT = 'date must be a real date written as YYYY-MM-DD.';
const WEEKDAYS_ONLY = 'Labs can be booked Monday to Friday only.';
const TOO_FAR = 'Bookings open 14 days ahead. Pick an earlier date.';

/** The unique index that refused an insert, mapped to what the student is told. */
const CLASH = {
  bookings_one_per_workstation: TAKEN,
  bookings_one_per_student: SAME_BLOCK,
};

/** { workstationId, date, block } from a request body, or a 400 that names the field. */
function parseSlot({ workstationId, date, block } = {}) {
  if (!Number.isInteger(workstationId)) throw new InvalidInput('workstationId must be a whole number.');
  if (!isRealDate(date)) throw new InvalidInput(DATE_FORMAT);
  if (!BLOCKS.includes(block)) throw new InvalidInput('block must be a number from 1 to 6.');
  return { workstationId, date, block };
}

/** A date students may open in the day view: a weekday from today to 14 days ahead. */
function checkOpenDay(date, now) {
  if (!isRealDate(date)) throw new InvalidInput(DATE_FORMAT);
  if (!isWeekday(date)) throw new InvalidInput(WEEKDAYS_ONLY);
  if (date < today(now)) throw new InvalidInput('That day has passed. Pick today or a later day.');
  if (date > lastBookableDate(now)) throw new InvalidInput(TOO_FAR);
}

const upcoming = (rows, now) => rows.filter((b) => !hasStarted(b.date, b.block, now));

export async function createBooking(db, user, input, now = new Date()) {
  requireUser(user);
  if (user.role === 'staff') throw new Forbidden('Staff accounts cannot book workstations.');
  const slot = parseSlot(input);
  if (hasStarted(slot.date, slot.block, now)) throw new InvalidInput('That block has already started. Pick a later one.');
  checkOpenDay(slot.date, now);

  const workstation = await workstations.findById(db, slot.workstationId);
  if (!workstation) throw new NotFound('That slot does not exist.');
  if (!workstation.inService) throw new Conflict('This workstation is out of service.');

  try {
    return await transaction(db, async (conn) => {
      // two requests from the same student wait for each other here, so both cannot pass the limit
      await users.lockForUpdate(conn, user.id);
      if (await bookings.findActiveForUserAt(conn, user.id, slot.date, slot.block)) throw new Conflict(SAME_BLOCK);
      const mine = upcoming(await bookings.listActiveForUserFrom(conn, user.id, today(now)), now);
      if (mine.length >= MAX_UPCOMING) throw new Conflict(`You already have ${MAX_UPCOMING} upcoming bookings. Cancel one first.`);
      if (await bookings.findActiveAt(conn, slot)) throw new Conflict(TAKEN);
      return await bookings.insert(conn, { userId: user.id, ...slot });
    });
  } catch (error) {
    // a request that slipped past the checks above at the same moment: the unique index decides
    if (error.code === '23505' && CLASH[error.constraint]) throw new Conflict(CLASH[error.constraint]);
    throw error;
  }
}

export async function cancelBooking(db, user, bookingId, now = new Date()) {
  requireUser(user);
  const id = Number(bookingId);
  const booking = Number.isInteger(id) && id > 0 ? await bookings.findById(db, id) : null;
  if (!booking) throw new NotFound('That booking does not exist.');
  // staff may cancel anyone's booking (AC-28); a student only their own (AC-9)
  if (booking.userId !== user.id && user.role !== 'staff') throw new Forbidden('You can only cancel your own bookings.');
  if (booking.status === 'cancelled') throw new Conflict('This booking is already cancelled.');
  if (hasStarted(booking.date, booking.block, now)) throw new Conflict('This booking has already started.');

  const cancelled = await bookings.cancel(db, booking.id, user.id);
  // cancelled by a parallel request between the read above and this update
  if (!cancelled) throw new Conflict('This booking is already cancelled.');
  return cancelled;
}

/** The day view: every workstation in service, by lab, with its six blocks. Never says who holds a block. */
export async function listDay(db, user, date, now = new Date()) {
  requireUser(user);
  checkOpenDay(date, now);
  const [stations, booked] = await Promise.all([workstations.listActiveWithLabs(db), bookings.listActiveOnDate(db, date)]);
  const holder = new Map(booked.map((b) => [`${b.workstationId}:${b.block}`, b]));

  const labs = new Map();
  for (const ws of stations) {
    if (!labs.has(ws.labId)) labs.set(ws.labId, { id: ws.labId, name: ws.labName, room: ws.labRoom, workstations: [] });
    const blocks = BLOCKS.map((block) => {
      const booking = holder.get(`${ws.id}:${block}`);
      const base = { block, ...blockTimes(block) };
      if (hasStarted(date, block, now)) return { ...base, state: 'past' };
      if (booking?.userId === user.id) return { ...base, state: 'yours', bookingId: booking.id };
      return { ...base, state: booking ? 'taken' : 'free' };
    });
    labs.get(ws.labId).workstations.push({ id: ws.id, label: ws.label, features: ws.features, blocks });
  }
  return { date, labs: [...labs.values()] };
}

/**
 * The signed-in user's bookings that have not started yet, soonest first, including any that
 * lab staff cancelled, so the student finds out (AC-28). Their own cancellations are left out.
 */
export async function listMine(db, user, now = new Date()) {
  requireUser(user);
  const rows = upcoming(await bookings.listForUserFrom(db, user.id, today(now)), now);
  return rows.map((b) => ({
    id: b.id,
    date: b.date,
    block: b.block,
    ...blockTimes(b.block),
    lab: b.lab,
    workstation: b.workstation,
    status: b.status,
    cancelledByStaff: b.status === 'cancelled',
  }));
}

/** The string id of a slot that MCP tools and the model use: "<workstationId>:<date>:<block>". */
export const slotIdOf = ({ workstationId, date, block }) => `${workstationId}:${date}:${block}`;

/** "7:2026-11-24:3" back into { workstationId, date, block }; createBooking then checks every field as usual. */
export function parseSlotId(slotId) {
  const match = /^(\d+):(\d{4}-\d{2}-\d{2}):(\d)$/.exec(typeof slotId === 'string' ? slotId.trim() : '');
  if (!match) throw new InvalidInput('slotId must look like 7:2026-11-24:3 (workstation id, date, block).');
  return { workstationId: Number(match[1]), date: match[2], block: Number(match[3]) };
}

/**
 * Every slot the user could book right now, in the 14-day window or on one date: workstations in
 * service, blocks not started, not held by anyone, and not in a block where the user already has a booking.
 */
export async function listFreeSlots(db, user, { date, lab, feature } = {}, now = new Date()) {
  requireUser(user);
  if (date !== undefined) checkOpenDay(date, now);
  const dates = date === undefined ? bookableDates(now) : [date];
  const [stations, booked] = await Promise.all([
    workstations.listActiveWithLabs(db),
    bookings.listActiveBetween(db, dates[0], dates[dates.length - 1]),
  ]);
  const taken = new Set(booked.map(slotIdOf));
  const mine = new Set(booked.filter((b) => b.userId === user.id).map((b) => `${b.date}:${b.block}`));
  const wanted = stations.filter((ws) => (!lab || ws.labName.toLowerCase().includes(lab.toLowerCase()))
    && (!feature || ws.features.includes(feature)));

  const slots = [];
  for (const day of dates) {
    for (const block of BLOCKS) {
      if (hasStarted(day, block, now) || mine.has(`${day}:${block}`)) continue;
      for (const ws of wanted) {
        const slot = { workstationId: ws.id, date: day, block };
        if (taken.has(slotIdOf(slot))) continue;
        slots.push({
          slotId: slotIdOf(slot), ...slot, ...blockTimes(block),
          workstation: ws.label, lab: ws.labName, room: ws.labRoom, features: ws.features,
        });
      }
    }
  }
  return slots;
}

/** For staff: every active booking on a date, with the student's email, by lab and workstation. */
export async function listAllForDay(db, user, date) {
  requireStaff(user);
  if (!isRealDate(date)) throw new InvalidInput(DATE_FORMAT);
  const rows = await bookings.listActiveOnDateWithPeople(db, date);
  return rows.map((b) => ({
    id: b.id, date: b.date, block: b.block, ...blockTimes(b.block), lab: b.lab, workstation: b.workstation, email: b.email,
  }));
}
