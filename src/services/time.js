// The one place that knows what a block is in time. Bookings store a date and a block number;
// every time check (AC-6, AC-8, "past" in AC-1) asks this module, which works in Europe/Sofia.
const ZONE = 'Europe/Sofia';
export const BLOCKS = [1, 2, 3, 4, 5, 6];
export const BOOKING_WINDOW_DAYS = 14;

const FIRST_START_HOUR = 8;
const BLOCK_HOURS = 2;

const pad = (n) => String(n).padStart(2, '0');
const startHour = (block) => FIRST_START_HOUR + (block - 1) * BLOCK_HOURS;

/** "10:00" and "12:00" for block 2. */
export const blockTimes = (block) => ({ start: `${pad(startHour(block))}:00`, end: `${pad(startHour(block) + BLOCK_HOURS)}:00` });

const sofia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Sofia's wall clock at an instant, as numbers. */
function wallClock(instant) {
  const parts = Object.fromEntries(sofia.formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute };
}

/** Today's date in Sofia, as YYYY-MM-DD. */
export function today(now) {
  const { year, month, day } = wallClock(now);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The instant a block starts: its date and hour on Sofia's clock, whatever the offset that day (EET or EEST). */
export function blockStart(date, block) {
  const [year, month, day] = date.split('-').map(Number);
  const wanted = Date.UTC(year, month - 1, day, startHour(block));
  const offset = (guess) => {
    const w = wallClock(new Date(guess));
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - guess;
  };
  const first = wanted - offset(wanted);
  return new Date(wanted - offset(first));
}

export const hasStarted = (date, block, now) => blockStart(date, block) <= now;

/** A real calendar date written as YYYY-MM-DD: "2026-02-30" is not one. */
export function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isWeekday(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last date that can be booked today. */
export const lastBookableDate = (now) => addDays(today(now), BOOKING_WINDOW_DAYS);
