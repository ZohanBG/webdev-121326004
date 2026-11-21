// The MCP server's project tools: the same services and rules as the HTTP API, acting as the person in MCP_TOKEN.
// "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createProjectTools, definitions } from '../mcp-server/project-tools.mjs';
import { signIn } from '../src/services/auth.js';
import { createBooking } from '../src/services/bookings.js';
import { freshDb, userByEmail, workstationIds, PASSWORD, STUDENT, STUDENT2, STAFF } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const TUE = '2026-11-24';

let db;
let ws;
beforeEach(async () => {
  db = await freshDb();
  ws = await workstationIds(db);
});
afterEach(async () => {
  await db.close();
});

/** The tools as the server builds them, acting as `email` (or with no token at all). */
async function toolsAs(email, extra = {}) {
  const env = email ? { MCP_TOKEN: (await signIn(db, { email, password: PASSWORD })).token } : {};
  return createProjectTools({ env: { ...env, ...extra.env }, db, now: () => NOW, model: extra.model });
}
const row = async (id) => (await db.query('SELECT status, cancelled_by FROM bookings WHERE id = $1', [id])).rows[0];

describe('who is calling', () => {
  test("AC-22 cancel_booking with a student's token and another student's booking id is refused like the HTTP route, and the row stays active", async () => {
    const theirs = await createBooking(db, await userByEmail(db, STUDENT2), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    const tools = await toolsAs(STUDENT);
    expect(await tools.call('cancel_booking', { bookingId: theirs.id }))
      .toEqual({ text: 'You can only cancel your own bookings.', isError: true });
    expect(await row(theirs.id)).toEqual({ status: 'active', cancelled_by: null });
  });

  test("AC-30 cancel_booking with a staff token and a student's upcoming booking cancels it, with the staff id in cancelled_by", async () => {
    const booking = await createBooking(db, await userByEmail(db, STUDENT), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    const tools = await toolsAs(STAFF);
    expect(await tools.call('cancel_booking', { bookingId: booking.id })).toEqual({ text: `Cancelled booking ${booking.id}.` });
    expect(await row(booking.id)).toEqual({ status: 'cancelled', cancelled_by: (await userByEmail(db, STAFF)).id });
  });

  test('without MCP_TOKEN, or with a token that is not a session, every tool explains what to do instead of acting', async () => {
    const none = await toolsAs(null);
    expect(await none.call('my_bookings')).toMatchObject({ isError: true, text: expect.stringContaining('MCP_TOKEN is not set') });
    const stale = createProjectTools({ env: { MCP_TOKEN: 'f'.repeat(64) }, db, now: () => NOW });
    expect(await stale.call('my_bookings')).toMatchObject({ isError: true, text: expect.stringContaining('not a valid session') });
  });
});

describe('the tools', () => {
  test('list_free_slots shows slot ids to book, filtered by lab and feature; book_slot books one; my_bookings shows it', async () => {
    const tools = await toolsAs(STUDENT);
    const list = await tools.call('list_free_slots', { date: TUE, lab: 'networks', feature: 'quiet' });
    expect(list.isError).toBeUndefined();
    expect(list.text.split('\n')[0]).toBe(`${ws.NL01}:${TUE}:1  NL-01, Networks Lab (room 2140), ${TUE} 08:00–10:00, quiet`);

    const booked = await tools.call('book_slot', { slotId: `${ws.NL01}:${TUE}:3` });
    expect(booked.text).toMatch(new RegExp(`^Booked ${ws.NL01}:${TUE}:3: ${TUE} 12:00–14:00\\. Booking id \\d+\\.$`));
    expect((await tools.call('my_bookings')).text).toMatch(/^booking \d+: 2026-11-24 12:00–14:00, NL-01, Networks Lab$/);
  });

  test('book_slot obeys the same rules as the web: a taken slot, staff, and a malformed slot id are tool errors', async () => {
    await createBooking(db, await userByEmail(db, STUDENT2), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    expect(await (await toolsAs(STUDENT)).call('book_slot', { slotId: `${ws.NL01}:${TUE}:3` }))
      .toEqual({ text: 'This workstation was just booked. Pick another slot.', isError: true });
    expect(await (await toolsAs(STAFF)).call('book_slot', { slotId: `${ws.NL02}:${TUE}:3` }))
      .toEqual({ text: 'Staff accounts cannot book workstations.', isError: true });
    expect(await (await toolsAs(STUDENT)).call('book_slot', { slotId: 'NL-01 tuesday' }))
      .toEqual({ text: 'slotId must look like 7:2026-11-24:3 (workstation id, date, block).', isError: true });
  });

  test('empty lists say so, and a cancellation by staff is marked in my_bookings', async () => {
    const tools = await toolsAs(STUDENT);
    expect((await tools.call('my_bookings')).text).toBe('You have no upcoming bookings.');
    await db.query('UPDATE workstations SET in_service = false');
    expect((await tools.call('list_free_slots', { date: TUE })).text).toBe(`No free slots on ${TUE} with these filters.`);
    await db.query('UPDATE workstations SET in_service = true');

    const booking = await createBooking(db, await userByEmail(db, STUDENT), { workstationId: ws.NL01, date: TUE, block: 3 }, NOW);
    await (await toolsAs(STAFF)).call('cancel_booking', { bookingId: booking.id });
    expect((await tools.call('my_bookings')).text).toMatch(/\(cancelled by lab staff\)$/);
  });

  test('suggest_slot returns a suggestion that is not booked, or the fallback message', async () => {
    const model = { model: 'fake', complete: async () => ({ stopReason: 'end_turn', text: JSON.stringify({ slotId: `${ws.NL03}:${TUE}:4`, reason: 'Quiet with two monitors.' }) }) };
    const withModel = await toolsAs(STUDENT, { model });
    expect((await withModel.call('suggest_slot', { text: 'quiet, two monitors, Tuesday afternoon' })).text)
      .toBe(`Suggestion, not booked: ${ws.NL03}:${TUE}:4  NL-03, Networks Lab (room 2140), ${TUE} 14:00–16:00, quiet, dual-monitor. Why: Quiet with two monitors. Call book_slot with ${ws.NL03}:${TUE}:4 to book it.`);
    expect((await db.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n).toBe(0);

    const noKey = await toolsAs(STUDENT, { env: { GEMINI_API_KEY: '' } });
    expect((await noKey.call('suggest_slot', { text: 'anything' })).text).toBe('Suggestions are not available right now. Pick a free slot from the list below.');
  });

  test('an unexpected failure is not dressed up as a tool error', async () => {
    const tools = await toolsAs(STUDENT);
    await db.query('DROP TABLE bookings CASCADE');
    await expect(tools.call('my_bookings')).rejects.toThrow();
  });
});

describe('the server process', () => {
  test('lists the Exercise 1 tools and every project tool from SPEC.md, each with a real description', async () => {
    const server = spawn(process.execPath, ['mcp-server/server.js'], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    server.stdout.on('data', (d) => { out += d; });
    server.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    await new Promise((resolve) => {
      const check = setInterval(() => { if (out.includes('\n')) { clearInterval(check); resolve(); } }, 20);
    });
    server.kill();
    const names = JSON.parse(out.split('\n')[0]).result.tools.map((t) => t.name);
    expect(names).toEqual(['find_lecture', 'search_lectures', 'list_free_slots', 'my_bookings', 'book_slot', 'cancel_booking', 'suggest_slot']);
    for (const d of definitions) expect(d.description.length).toBeGreaterThanOrEqual(20);
  });
});
