// The /account page: which ways a person can sign in, and setting a password.
import bcrypt from 'bcryptjs';
import * as users from '../data/users.js';
import * as identities from '../data/identities.js';
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
 */
export async function setPassword(db, user, { password, currentPassword } = {}) {
  requireUser(user);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new InvalidInput(`The new password needs at least ${MIN_PASSWORD} characters.`);
  }
  const row = await users.findById(db, user.id);
  if (row.password_hash && !(typeof currentPassword === 'string' && await bcrypt.compare(currentPassword, row.password_hash))) {
    throw new Forbidden('Your current password is not right.');
  }
  await users.setPasswordHash(db, user.id, await bcrypt.hash(password, 10));
}
