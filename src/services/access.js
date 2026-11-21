// Who may call a service function. Every service starts with one of these.
import { NotSignedIn, Forbidden } from './errors.js';

export function requireUser(user) {
  if (!user) throw new NotSignedIn();
}

export function requireStaff(user) {
  requireUser(user);
  if (user.role !== 'staff') throw new Forbidden('Only lab staff can do this.');
}
