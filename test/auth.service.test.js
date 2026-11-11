// The sign-in rules, called directly on the service: no HTTP involved.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { signIn, signOut, userForSession, hashToken } from '../src/services/auth.js';
import { freshDb, PASSWORD, STUDENT } from './helpers.js';

let db;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('auth service', () => {
  test('AC-26 signIn refuses a wrong password with WrongCredentials', async () => {
    await expect(signIn(db, { email: STUDENT, password: 'not-the-password' }))
      .rejects.toMatchObject({ name: 'WrongCredentials', message: 'Wrong email or password.' });
  });

  test('AC-26 signIn refuses an unknown email exactly like a wrong password', async () => {
    await expect(signIn(db, { email: 'nobody@labspot.test', password: PASSWORD }))
      .rejects.toMatchObject({ name: 'WrongCredentials' });
  });

  test('AC-26 an account with no password (Google only) cannot sign in with one', async () => {
    await db.query("INSERT INTO users (email, password_hash) VALUES ('google-only@labspot.test', NULL)");
    await expect(signIn(db, { email: 'google-only@labspot.test', password: PASSWORD }))
      .rejects.toMatchObject({ name: 'WrongCredentials' });
  });

  test('AC-31 signIn refuses an empty email or an empty password with InvalidInput', async () => {
    for (const input of [{ email: '', password: PASSWORD }, { email: STUDENT, password: '' }, { email: '   ', password: 'x' }, {}, undefined]) {
      await expect(signIn(db, input)).rejects.toMatchObject({ name: 'InvalidInput', message: 'Enter your email and password.' });
    }
  });

  test('signIn accepts the right password, any email case, and stores only a hash of the session token', async () => {
    const { token, user } = await signIn(db, { email: ' Student@LabSpot.test ', password: PASSWORD });
    expect(user).toMatchObject({ email: STUDENT, role: 'student' });
    const { rows } = await db.query('SELECT id FROM sessions WHERE user_id = $1', [user.id]);
    expect(rows.map((r) => r.id)).toContain(hashToken(token));
    expect(rows.map((r) => r.id)).not.toContain(token);
    expect(await userForSession(db, token)).toMatchObject({ email: STUDENT });
  });

  test('AC-27 signOut ends the session: the token signs nobody in afterwards', async () => {
    const { token } = await signIn(db, { email: STUDENT, password: PASSWORD });
    await signOut(db, token);
    expect(await userForSession(db, token)).toBeNull();
  });

  test('an expired session signs nobody in', async () => {
    const { token } = await signIn(db, { email: STUDENT, password: PASSWORD });
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1", [hashToken(token)]);
    expect(await userForSession(db, token)).toBeNull();
  });
});
