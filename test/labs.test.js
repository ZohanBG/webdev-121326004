// The labs list through real HTTP requests to the app.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, startApp, login } from './helpers.js';

let db;
let app;
beforeAll(async () => {
  db = await freshDb();
  app = await startApp(db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('GET /api/labs and /labs', () => {
  test('AC-23 without a session, /labs lands on /login and /api/labs is 401 with no lab names', async () => {
    const page = await fetch(`${app.base}/labs`, { redirect: 'manual' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/login');

    const api = await fetch(`${app.base}/api/labs`);
    expect(api.status).toBe(401);
    const text = await api.text();
    expect(JSON.parse(text)).toEqual({ error: 'Sign in first.' });
    for (const name of ['Networks Lab', 'GPU Lab', 'Project Room']) expect(text).not.toContain(name);
  });

  test('AC-24 a signed-in student sees the three seeded labs with room and active workstations, one of them 0', async () => {
    const { cookie } = await login(app.base);
    const res = await fetch(`${app.base}/api/labs`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const labs = await res.json();
    expect(labs).toHaveLength(3);
    expect(labs.map(({ name, room, activeWorkstations }) => ({ name, room, activeWorkstations }))).toEqual([
      { name: 'GPU Lab', room: '1418', activeWorkstations: 2 },
      { name: 'Networks Lab', room: '2140', activeWorkstations: 3 },
      { name: 'Project Room', room: '3302', activeWorkstations: 0 },
    ]);
  });

  test('AC-25 deleting the lab with no workstations from the database removes it from the list', async () => {
    const { cookie } = await login(app.base);
    await db.query("DELETE FROM labs WHERE name = 'Project Room'");
    const labs = await (await fetch(`${app.base}/api/labs`, { headers: { cookie } })).json();
    expect(labs.map((l) => l.name)).toEqual(['GPU Lab', 'Networks Lab']);
  });

  test('a lab that still has workstations cannot be deleted (ON DELETE RESTRICT keeps history)', async () => {
    await expect(db.query("DELETE FROM labs WHERE name = 'Networks Lab'")).rejects.toThrow(/foreign key/);
  });
});
