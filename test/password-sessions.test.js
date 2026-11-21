// S2 (self-review, Exercise 5): changing a password did not end the account's other sessions, so a stolen
// session cookie kept working for up to 7 days after the owner changed the password.
// AC-46: a password change ends every other session of that account and keeps the one it was made from.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openSession, userForSession } from '../src/services/auth.js';
import { setPassword } from '../src/services/account.js';
import { freshDb, startApp, login, userByEmail, PASSWORD, STUDENT, STUDENT2 } from './helpers.js';

const NEW_PASSWORD = 'a-brand-new-password';

describe('S2: a password change ends the other sessions (the service)', () => {
  let db;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(async () => {
    await db.close();
  });

  test('AC-46 S2 setPassword ends every other session of the account and keeps the one it was called from', async () => {
    const user = await userByEmail(db, STUDENT);
    const here = await openSession(db, user);
    const stolen = await openSession(db, user);
    const other = await openSession(db, await userByEmail(db, STUDENT2));
    await setPassword(db, user, { password: NEW_PASSWORD, currentPassword: PASSWORD }, { keepToken: here.token });
    expect(await userForSession(db, here.token)).toMatchObject({ email: STUDENT });
    expect(await userForSession(db, stolen.token)).toBeNull();
    // another person's session is not touched
    expect(await userForSession(db, other.token)).toMatchObject({ email: STUDENT2 });
  });

  test('AC-46 S2 called without a session to keep (not from a browser), it ends every session of the account', async () => {
    const user = await userByEmail(db, STUDENT2);
    const one = await openSession(db, user);
    await setPassword(db, user, { password: NEW_PASSWORD, currentPassword: PASSWORD });
    expect(await userForSession(db, one.token)).toBeNull();
  });

  test('AC-46 S2 a refused change (wrong current password) ends no session', async () => {
    const user = await userByEmail(db, STUDENT);
    const kept = await openSession(db, user);
    await expect(setPassword(db, user, { password: 'yet-another-password', currentPassword: 'not-the-password' }))
      .rejects.toMatchObject({ name: 'Forbidden' });
    expect(await userForSession(db, kept.token)).toMatchObject({ email: STUDENT });
  });
});

describe('S2: a password change ends the other sessions (HTTP)', () => {
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

  const me = async (cookie) => (await fetch(`${app.base}/api/auth/me`, { headers: { cookie } })).status;

  test('AC-46 S2 after a password change in one browser, the other browser\x27s session gets 401 and this one still works', async () => {
    const here = (await login(app.base, STUDENT)).cookie;
    const elsewhere = (await login(app.base, STUDENT)).cookie;
    expect(await me(elsewhere)).toBe(200);

    const res = await fetch(`${app.base}/api/account/password`, {
      method: 'POST',
      headers: { cookie: here, 'content-type': 'application/json' },
      body: JSON.stringify({ password: NEW_PASSWORD, currentPassword: PASSWORD }),
    });
    expect(res.status).toBe(204);
    expect(await me(elsewhere)).toBe(401);
    expect(await me(here)).toBe(200);
  });
});
