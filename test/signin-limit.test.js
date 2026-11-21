// S1 (self-review, Exercise 5): sign-in had no limit on attempts, while the seeded accounts share one password.
// AC-45: 5 failed sign-ins for one email from one address within 15 minutes lock that pair for 15 minutes.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { signIn } from '../src/services/auth.js';
import { freshDb, startApp, PASSWORD, STUDENT, STUDENT2 } from './helpers.js';

const NOW = new Date('2026-11-23T09:00:00Z');
const later = (minutes) => new Date(NOW.getTime() + minutes * 60 * 1000);
const LOCKED = { name: 'TooManyAttempts', message: 'Too many sign-in attempts. Try again in 15 minutes.' };

let db;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

/** `times` wrong passwords for `email` from `ip` at `at`; each one must still be the ordinary refusal. */
async function fail(email, ip, times, at = NOW) {
  for (let i = 0; i < times; i++) {
    await expect(signIn(db, { email, password: 'not-the-password' }, { ip, now: at })).rejects.toMatchObject({ name: 'WrongCredentials' });
  }
}

describe('S1: a limit on sign-in attempts (the service)', () => {
  test('AC-45 S1 after 5 wrong passwords from one address, even the right password is refused for that email and address', async () => {
    await fail(STUDENT, '203.0.113.1', 5);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.1', now: later(1) })).rejects.toMatchObject(LOCKED);
  });

  test('AC-45 S1 the lock is per email and address: another address, or another email, still signs in', async () => {
    await fail(STUDENT2, '203.0.113.2', 5);
    await expect(signIn(db, { email: STUDENT2, password: PASSWORD }, { ip: '203.0.113.3', now: later(1) })).resolves.toMatchObject({ user: { email: STUDENT2 } });
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.2', now: later(1) })).resolves.toMatchObject({ user: { email: STUDENT } });
  });

  test('AC-45 S1 the lock ends 15 minutes after the failures', async () => {
    await fail(STUDENT, '203.0.113.4', 5);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.4', now: later(14) })).rejects.toMatchObject(LOCKED);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.4', now: later(16) })).resolves.toMatchObject({ user: { email: STUDENT } });
  });

  test('AC-45 S1 an unknown email is counted the same way, so the answer does not reveal which accounts exist', async () => {
    await fail('nobody@labspot.test', '203.0.113.5', 5);
    await expect(signIn(db, { email: 'nobody@labspot.test', password: PASSWORD }, { ip: '203.0.113.5', now: later(1) })).rejects.toMatchObject(LOCKED);
  });

  test('AC-45 S1 a successful sign-in clears the count; the email is matched without case or spaces', async () => {
    await fail(STUDENT, '203.0.113.6', 4);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.6', now: NOW })).resolves.toBeTruthy();
    await fail(` ${STUDENT.toUpperCase()} `, '203.0.113.6', 4);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.6', now: NOW })).resolves.toBeTruthy();
  });

  test('AC-45 S1 an empty field is a 400 and is not counted as a failure', async () => {
    for (let i = 0; i < 6; i++) {
      await expect(signIn(db, { email: STUDENT, password: '' }, { ip: '203.0.113.7', now: NOW })).rejects.toMatchObject({ name: 'InvalidInput' });
    }
    await expect(signIn(db, { email: STUDENT, password: PASSWORD }, { ip: '203.0.113.7', now: NOW })).resolves.toBeTruthy();
  });
});

describe('S1: a limit on sign-in attempts (HTTP, behind a proxy like Render)', () => {
  let app;
  let appDb;
  beforeAll(async () => {
    appDb = await freshDb();
    app = await startApp(appDb, { now: () => NOW });
  });
  afterAll(async () => {
    await app.close();
    await appDb.close();
  });

  const login = (password, address) => fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    // Render puts the caller's address last in X-Forwarded-For; with trust proxy 1 that is req.ip
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body: JSON.stringify({ email: STUDENT, password }),
  });

  test('AC-45 S1 the 6th sign-in from one address gets 429 with the sentence and no session cookie; another address is not locked', async () => {
    for (let i = 0; i < 5; i++) expect((await login('not-the-password', '198.51.100.20')).status).toBe(401);
    const locked = await login(PASSWORD, '198.51.100.20');
    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    expect(locked.headers.get('set-cookie')).toBeNull();
    expect((await login(PASSWORD, '198.51.100.21')).status).toBe(200);
  });

  test('AC-45 S1 an address the caller adds in front of the proxy\x27s own entry is ignored', async () => {
    // a client cannot dodge the limit by sending its own X-Forwarded-For: only the last entry counts
    for (let i = 0; i < 5; i++) expect((await login('not-the-password', `10.0.0.${i}, 198.51.100.30`)).status).toBe(401);
    expect((await login(PASSWORD, '10.9.9.9, 198.51.100.30')).status).toBe(429);
  });
});
