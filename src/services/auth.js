import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as users from '../data/users.js';
import * as sessions from '../data/sessions.js';
import { InvalidInput, WrongCredentials } from './errors.js';

const SESSION_DAYS = 7;

// Compared against when the email is unknown, so an unknown email takes as long as a wrong password.
const NO_USER_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Checks email and password and opens a session. Returns the cookie value, which is never stored as is. */
export async function signIn(db, { email, password } = {}) {
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    throw new InvalidInput('Enter your email and password.');
  }
  const user = await users.findByEmail(db, email.trim());
  const matches = await bcrypt.compare(password, user?.password_hash ?? NO_USER_HASH);
  // an account with no password (Google only, or cleared on linking) cannot sign in with one
  if (!user || !user.password_hash || !matches) throw new WrongCredentials();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
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
