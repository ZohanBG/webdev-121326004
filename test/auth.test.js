// Sign-in and sign-out through real HTTP requests to the app.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, startApp, login, STUDENT } from './helpers.js';

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

describe('POST /api/auth/login', () => {
  test('AC-26 a wrong password gets 401, "Wrong email or password." and no session cookie', async () => {
    const { res, setCookie } = await login(app.base, STUDENT, 'not-the-password');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Wrong email or password.' });
    expect(setCookie).toBeNull();
  });

  test('AC-26 every stored password is a bcrypt hash starting with $2', async () => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE password_hash IS NOT NULL');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.password_hash.startsWith('$2')).toBe(true);
  });

  test('AC-31 an empty email or password gets 400, "Enter your email and password." and no cookie', async () => {
    for (const [email, password] of [['', 'x'], [STUDENT, '']]) {
      const { res, setCookie } = await login(app.base, email, password);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Enter your email and password.' });
      expect(setCookie).toBeNull();
    }
  });

  test('a body that is not JSON gets 400 with a readable message', async () => {
    const res = await fetch(`${app.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The request body is not valid JSON.' });
  });

  test('the right password gets 200, the user, and an HttpOnly SameSite=Lax session cookie', async () => {
    const { res, setCookie } = await login(app.base);
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ email: STUDENT, role: 'student' });
    expect(setCookie).toMatch(/^labspot_session=[0-9a-f]{64};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toMatch(/Secure/);
  });
});

describe('POST /api/auth/logout', () => {
  test('AC-27 after Sign out, opening /labs lands on /login again', async () => {
    const { cookie } = await login(app.base);
    const before = await fetch(`${app.base}/labs`, { headers: { cookie }, redirect: 'manual' });
    expect(before.status).toBe(200);

    const out = await fetch(`${app.base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/labspot_session=;/);

    const after = await fetch(`${app.base}/labs`, { headers: { cookie }, redirect: 'manual' });
    expect(after.status).toBe(302);
    expect(after.headers.get('location')).toBe('/login');
  });

  test('signing out without a session still answers 204', async () => {
    const res = await fetch(`${app.base}/api/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
  });
});

describe('pages', () => {
  test('/labs.html cannot skip the sign-in check: it redirects to /labs', async () => {
    const res = await fetch(`${app.base}/labs.html`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/labs');
  });

  test('/ sends a visitor to /login and a signed-in user to /labs; /login sends a signed-in user to /labs', async () => {
    const visitor = await fetch(`${app.base}/`, { redirect: 'manual' });
    expect(visitor.headers.get('location')).toBe('/login');
    expect((await fetch(`${app.base}/login`)).status).toBe(200);

    const { cookie } = await login(app.base);
    const home = await fetch(`${app.base}/`, { headers: { cookie }, redirect: 'manual' });
    expect(home.headers.get('location')).toBe('/labs');
    const loginPage = await fetch(`${app.base}/login`, { headers: { cookie }, redirect: 'manual' });
    expect(loginPage.headers.get('location')).toBe('/labs');
  });

  test('an unknown API path gets 404 as JSON', async () => {
    const res = await fetch(`${app.base}/api/nothing-here`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });
});
