// Staff manage workstations: add them, change their features, take them out of service.
import * as labs from '../data/labs.js';
import * as workstations from '../data/workstations.js';
import * as bookings from '../data/bookings.js';
import { InvalidInput, NotFound, Conflict } from './errors.js';
import { requireStaff } from './access.js';
import { hasStarted, today } from './time.js';

export const FEATURES = ['quiet', 'dual-monitor', 'gpu'];

function parseFeatures(features) {
  if (!Array.isArray(features) || !features.every((f) => FEATURES.includes(f))) {
    throw new InvalidInput('features may only contain quiet, dual-monitor and gpu.');
  }
  return [...new Set(features)];
}

export async function addWorkstation(db, user, { labId, label, features = [] } = {}) {
  requireStaff(user);
  if (!Number.isInteger(labId)) throw new InvalidInput('labId must be a whole number.');
  if (typeof label !== 'string' || !label.trim()) throw new InvalidInput('label is required.');
  const clean = parseFeatures(features);
  if (!(await labs.findById(db, labId))) throw new NotFound('That lab does not exist.');
  try {
    return await workstations.insert(db, { labId, label: label.trim(), features: clean });
  } catch (error) {
    if (error.code === '23505') throw new Conflict('That lab already has a workstation with this label.');
    throw error;
  }
}

/**
 * Changes a workstation's features and/or whether it is in service. Taking it out of service is
 * refused while it still has upcoming bookings, so nobody turns up to a workstation that is gone.
 */
export async function updateWorkstation(db, user, workstationId, changes, now = new Date()) {
  requireStaff(user);
  const id = Number(workstationId);
  const current = Number.isInteger(id) && id > 0 ? await workstations.findById(db, id) : null;
  if (!current) throw new NotFound('That workstation does not exist.');

  const { features, inService } = changes ?? {};
  if (features === undefined && typeof inService !== 'boolean') throw new InvalidInput('Send features, inService, or both.');
  const update = {
    features: features === undefined ? null : parseFeatures(features),
    inService: typeof inService === 'boolean' ? inService : null,
  };
  if (inService === false) {
    const ahead = (await bookings.listActiveForWorkstationFrom(db, id, today(now))).filter((b) => !hasStarted(b.date, b.block, now));
    if (ahead.length > 0) throw new Conflict(`Cancel its ${ahead.length} upcoming booking${ahead.length === 1 ? '' : 's'} first.`);
  }
  return workstations.update(db, id, update);
}
