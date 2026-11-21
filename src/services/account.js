// The /account page: which ways a person can sign in, and setting a password.
import bcrypt from 'bcryptjs';
import * as users from '../data/users.js';
import * as identities from '../data/identities.js';
import * as sessions from '../data/sessions.js';
import { transaction } from '../data/db.js';
import { hashToken } from './auth.js';
import { InvalidInput, Forbidden } from './errors.js';
import { requireUser } from './access.js';

const MIN_PASSWORD = 10;

export async function getAccount(db, user) {
  requireUser(user);
  const [row, providers] = await Promise.all([users.findById(db, user.id), identities.listProviders(db, user.id)]);
  return { email: row.email, role: row.role, hasPassword: Boolean(row.password_hash), providers };
}

/**
 * Sets a password. After a Google link cleared it (AC-20) none is needed; changing an existing
 * password needs the current one, so a borrowed session alone cannot take the account.
 * A new password also ends every other session of the account (AC-46): a stolen session cookie stops
 * working. `keepToken` is the session the change was made from (the route passes it), which stays.
 */
export async function setPassword(db, user, { password, currentPassword } = {}, { keepToken } = {}) {
  requireUser(user);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new InvalidInput(`The new password needs at least ${MIN_PASSWORD} characters.`);
  }
  const row = await users.findById(db, user.id);
  if (row.password_hash && !(typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, row.password_hash))) {
    throw new Forbidden('Your current password is not right.');
  }
  const hash = await bcrypt.hash(password, 10);
  await transaction(db, async (conn) => {
    await users.setPasswordHash(conn, user.id, hash);
    await sessions.removeOthersForUser(conn, user.id, keepToken ? hashToken(keepToken) : null);
  });
}
