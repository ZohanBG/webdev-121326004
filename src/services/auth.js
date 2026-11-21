import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as users from '../data/users.js';
import * as sessions from '../data/sessions.js';
import * as failures from '../data/signInFailures.js';
import { InvalidInput, WrongCredentials, TooManyAttempts } from './errors.js';

const SESSION_DAYS = 7;

// AC-45: this many failures for one email from one address within the window lock that pair until they age out.
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

// Compared against when the email is unknown, so an unknown email takes as long as a wrong password.
const NO_USER_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Checks email and password and opens a session. `ip` is the caller's address (the route passes req.ip) and
 * `now` the clock. After MAX_FAILURES failures for this email from this address within WINDOW_MINUTES, even the
 * right password is refused until they age out (AC-45). An unknown email is counted the same way, so the
 * answers do not reveal which accounts exist; a missing field is a 400 and does not count.
 */
export async function signIn(db, { email, password } = {}, { ip = 'unknown', now = new Date() } = {}) {
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    throw new InvalidInput('Enter your email and password.');
  }
  const key = { email: email.trim().toLowerCase(), ip };
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000);
  if (await failures.countSince(db, { ...key, since }) >= MAX_FAILURES) throw new TooManyAttempts();

  const user = await users.findByEmail(db, key.email);
  const matches = await bcrypt.compare(password, user?.password_hash ?? NO_USER_HASH);
  // an account with no password (Google only, or cleared on linking) cannot sign in with one
  if (!user || !user.password_hash || !matches) {
    await failures.removeOlderThan(db, since);
    await failures.insert(db, { ...key, at: now });
    throw new WrongCredentials();
  }

  await failures.clear(db, key);
  return openSession(db, user);
}

/** A new session for a user, by password or by a provider. Returns the cookie value, which is never stored as is. */
export async function openSession(db, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // S7: every new session also clears the expired ones, so the table does not only grow
  await sessions.removeExpired(db);
  await sessions.insert(db, { id: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt, user: { id: user.id, email: user.email, role: user.role } };
}

export async function signOut(db, token) {
  await sessions.remove(db, hashToken(token));
}

/** The signed-in user for a cookie value, or null when the session is unknown or expired. */
export async function userForSession(db, token) {
  return sessions.findUser(db, hashToken(token));
}
