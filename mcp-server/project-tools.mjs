// LabSpot's tools for the MCP server. Each one calls the same service function as the HTTP route,
// so a tool obeys exactly the rules an API request does: one set of rules, two front doors.
// The server acts as one person: the session token in MCP_TOKEN, checked like a browser's cookie.
import { createPool } from '../src/data/db.js';
import { userForSession } from '../src/services/auth.js';
import { listFreeSlots, listMine, createBooking, cancelBooking, parseSlotId, slotIdOf } from '../src/services/bookings.js';
import { suggestSlot, createModelClient } from '../src/services/suggest.js';
import { ServiceError } from '../src/services/errors.js';
import { blockTimes } from '../src/services/time.js';

export const definitions = [
  {
    name: 'list_free_slots',
    description: 'Lists the free lab workstation slots on one weekday (YYYY-MM-DD) within the next 14 days, optionally only in one lab or only with one feature. Use it before book_slot: each line starts with the slot id to book.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, as YYYY-MM-DD' },
        lab: { type: 'string', description: 'Part of a lab name, e.g. "GPU"' },
        feature: { type: 'string', enum: ['quiet', 'dual-monitor', 'gpu'] },
      },
      required: ['date'],
    },
  },
  {
    name: 'my_bookings',
    description: "Lists the signed-in person's upcoming bookings with booking id, date, time, workstation and lab; bookings that lab staff cancelled are marked. Use it to find the id for cancel_booking.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'book_slot',
    description: 'Books one free slot for the signed-in student, by the slot id from list_free_slots or suggest_slot (e.g. "7:2026-11-24:3"). Refused when the slot is taken, or the student already has 3 upcoming bookings or a booking in that block.',
    inputSchema: {
      type: 'object',
      properties: { slotId: { type: 'string', description: 'workstationId:YYYY-MM-DD:block, e.g. 7:2026-11-24:3' } },
      required: ['slotId'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancels one booking that has not started yet, by its booking id from my_bookings. A student may cancel only their own bookings; lab staff may cancel any.',
    inputSchema: {
      type: 'object',
      properties: { bookingId: { type: 'integer', description: 'The booking id from my_bookings' } },
      required: ['bookingId'],
    },
  },
  {
    name: 'suggest_slot',
    description: 'Turns a plain-language request (e.g. "quiet place with two monitors, Thursday afternoon") into one free slot with a short reason. It never books: call book_slot with the slot id to book it. For students.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 300, description: 'What the student needs, in their own words' } },
      required: ['text'],
    },
  },
];

/** A refusal the caller should read, like a service's own errors. */
class ToolError extends Error {}

const slotLine = (s) => `${s.slotId}  ${s.workstation}, ${s.lab} (room ${s.room}), ${s.date} ${s.start}–${s.end}${s.features.length ? `, ${s.features.join(', ')}` : ''}`;

/**
 * The tools, bound to a database and a clock. In the server they come from the environment
 * (DATABASE_URL, MCP_TOKEN, the model key); tests pass PGlite and a fixed clock instead.
 */
export function createProjectTools({ env = process.env, db: given, now = () => new Date(), model } = {}) {
  let db = given;
  let client = model;
  const database = () => {
    db ??= createPool(env.DATABASE_URL);
    return db;
  };

  async function caller() {
    if (!env.MCP_TOKEN) {
      throw new ToolError('MCP_TOKEN is not set. Sign in to LabSpot in a browser, copy the value of the labspot_session cookie, and set it as MCP_TOKEN.');
    }
    const user = await userForSession(database(), env.MCP_TOKEN);
    if (!user) throw new ToolError('MCP_TOKEN is not a valid session any more. Sign in again and copy a fresh labspot_session cookie.');
    return user;
  }

  const handlers = {
    async list_free_slots({ date, lab, feature }) {
      const user = await caller();
      const slots = await listFreeSlots(database(), user, { date, lab, feature }, now());
      return slots.length ? slots.map(slotLine).join('\n') : `No free slots on ${date} with these filters.`;
    },

    async my_bookings() {
      const user = await caller();
      const mine = await listMine(database(), user, now());
      if (mine.length === 0) return 'You have no upcoming bookings.';
      return mine.map((b) => `booking ${b.id}: ${b.date} ${b.start}–${b.end}, ${b.workstation}, ${b.lab}${b.cancelledByStaff ? ' (cancelled by lab staff)' : ''}`).join('\n');
    },

    async book_slot({ slotId }) {
      const user = await caller();
      const booking = await createBooking(database(), user, parseSlotId(slotId), now());
      const { start, end } = blockTimes(booking.block);
      return `Booked ${slotIdOf(booking)}: ${booking.date} ${start}–${end}. Booking id ${booking.id}.`;
    },

    async cancel_booking({ bookingId }) {
      const user = await caller();
      const cancelled = await cancelBooking(database(), user, bookingId, now());
      return `Cancelled booking ${cancelled.id}.`;
    },

    async suggest_slot({ text }) {
      client ??= createModelClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL });
      const user = await caller();
      const { suggestion, message } = await suggestSlot(database(), user, { text }, { client, now: now() });
      if (!suggestion) return message;
      return `Suggestion, not booked: ${slotLine(suggestion)}. Why: ${suggestion.reason} Call book_slot with ${suggestion.slotId} to book it.`;
    },
  };

  return {
    has: (name) => Object.hasOwn(handlers, name),

    /** { text } for the model, or { text, isError } when the rules refused it: a tool error, never a crash. */
    async call(name, args) {
      try {
        return { text: await handlers[name](args ?? {}) };
      } catch (error) {
        const readable = error instanceof ServiceError || error instanceof ToolError || /DATABASE_URL/.test(error.message);
        if (readable) return { text: error.message, isError: true };
        throw error;
      }
    },

    async close() {
      if (!given && db) await db.end();
    },
  };
}
