// The fixed feature list and the feature filter (AC-40): the service, the HTTP API and the MCP tool.
// "Now" is Monday 2026-11-23, 09:30 in Sofia.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { listDay, listFreeSlots } from '../src/services/bookings.js';
import { FEATURE_IDS } from '../src/services/features.js';
import { createProjectTools } from '../mcp-server/project-tools.mjs';
import { signIn } from '../src/services/auth.js';
import { freshDb, startApp, login, userByEmail, PASSWORD, STUDENT } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');
const MON = '2026-11-23';
const TUE = '2026-11-24';

let db;
let app;
let student;
beforeEach(async () => {
  db = await freshDb();
  app = await startApp(db, { now: () => NOW });
  student = await userByEmail(db, STUDENT);
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const labelsOf = (day) => day.labs.flatMap((l) => l.workstations.map((w) => w.label));

describe('the feature list', () => {
  test('GET /api/features lists the 16 features in four groups, from the one list in code, without signing in', async () => {
    const res = await fetch(`${app.base}/api/features`);
    expect(res.status).toBe(200);
    const groups = await res.json();
    expect(groups.map((g) => g.group)).toEqual(['Hardware', 'Software / OS', 'Lab equipment', 'Environment']);
    expect(groups.flatMap((g) => g.features.map((f) => f.id))).toEqual(FEATURE_IDS);
    expect(groups[0].features[1]).toEqual({ id: 'gpu-cuda', label: 'NVIDIA GPU (CUDA)' });
    expect(FEATURE_IDS).toHaveLength(16);
  });
});

describe('the feature filter in the service', () => {
  const labelsFor = async (features) => labelsOf(await listDay(db, student, MON, NOW, { features }));

  test('AC-40 the day view shows only workstations that have every listed feature; empty or missing means no filter', async () => {
    expect(await labelsFor(['quiet', 'dual-monitor'])).toEqual(['NL-03']);
    expect(await labelsFor('quiet,dual-monitor')).toEqual(['NL-03']);
    expect(await labelsFor(' gpu-cuda , ')).toEqual(['GL-01', 'GL-02']);
    expect(await labelsFor('')).toEqual(['GL-01', 'GL-02', 'NL-01', 'NL-02', 'NL-03']);
    expect(await labelsFor(undefined)).toHaveLength(5);
    // AND: no workstation is both quiet and has a CUDA GPU, so the day has no labs to show
    expect((await listDay(db, student, MON, NOW, { features: ['quiet', 'gpu-cuda'] })).labs).toEqual([]);
  });

  test('AC-40 an unknown feature id is refused with a sentence naming it', async () => {
    await expect(listDay(db, student, MON, NOW, { features: 'quiet,laser' }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: '"laser" is not a known feature.' });
    await expect(listFreeSlots(db, student, { date: TUE, features: ['gpu'] }, NOW))
      .rejects.toMatchObject({ name: 'InvalidInput', message: '"gpu" is not a known feature.' });
  });

  test('AC-40 the free-slot list used by MCP applies the same AND filter', async () => {
    const slots = await listFreeSlots(db, student, { date: TUE, features: ['quiet', 'dual-monitor'] }, NOW);
    expect(new Set(slots.map((s) => s.workstation))).toEqual(new Set(['NL-03']));
  });
});

describe('the feature filter over HTTP and MCP', () => {
  test('AC-40 GET /api/slots?features=quiet,dual-monitor returns only workstations with both; empty returns all; an unknown id gets 400 naming it', async () => {
    const { cookie } = await login(app.base);
    const day = async (query) => fetch(`${app.base}/api/slots?date=${TUE}${query}`, { headers: { cookie } });
    expect(labelsOf(await (await day('&features=quiet,dual-monitor')).json())).toEqual(['NL-03']);
    expect(labelsOf(await (await day('&features=quiet&features=dual-monitor')).json())).toEqual(['NL-03']);
    expect(labelsOf(await (await day('&features=')).json())).toHaveLength(5);
    expect(labelsOf(await (await day('&features=quiet,gpu-cuda')).json())).toEqual([]);
    const unknown = await day('&features=quiet,laser');
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: '"laser" is not a known feature.' });
  });

  test('AC-12 a staff member who removes one feature and saves (the staff page\'s PATCH) gets 200, and the day view shows the rest', async () => {
    const { cookie } = await login(app.base, 'staff@labspot.test');
    const { rows: [gl02] } = await db.query("SELECT id, features FROM workstations WHERE label = 'GL-02'");
    const fewer = gl02.features.filter((f) => f !== 'matlab');
    const res = await fetch(`${app.base}/api/workstations/${gl02.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ features: fewer }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).features).toEqual(fewer);
    const day = await (await fetch(`${app.base}/api/slots?date=${TUE}`, { headers: { cookie } })).json();
    expect(day.labs.flatMap((l) => l.workstations).find((w) => w.label === 'GL-02').features).toEqual(fewer);
  });

  test('AC-40 the MCP tool list_free_slots takes the same AND filter, and names an unknown id', async () => {
    const { token } = await signIn(db, { email: STUDENT, password: PASSWORD });
    const tools = createProjectTools({ env: { MCP_TOKEN: token }, db, now: () => NOW });
    const both = await tools.call('list_free_slots', { date: TUE, features: ['quiet', 'dual-monitor'] });
    expect(both.isError).toBeUndefined();
    expect(both.text.split('\n').every((line) => line.includes(' NL-03, '))).toBe(true);
    expect(await tools.call('list_free_slots', { date: TUE, features: ['laser'] }))
      .toEqual({ text: '"laser" is not a known feature.', isError: true });
  });
});
