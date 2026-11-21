import * as labs from '../data/labs.js';
import * as workstations from '../data/workstations.js';
import { InvalidInput } from './errors.js';
import { requireUser, requireStaff } from './access.js';

/** The labs any signed-in user may see. The route checks the session first; this guards every other caller (MCP). */
export async function listLabs(db, user) {
  requireUser(user);
  return labs.listWithActiveCounts(db);
}

const required = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new InvalidInput(`${field} is required.`);
  return value.trim();
};

export async function addLab(db, user, { name, room } = {}) {
  requireStaff(user);
  return labs.insert(db, { name: required(name, 'name'), room: required(room, 'room') });
}

/** For the staff page: every lab with all its workstations, in service or not. */
export async function listLabsForStaff(db, user) {
  requireStaff(user);
  const [all, stations] = await Promise.all([labs.listAll(db), workstations.listAll(db)]);
  return all.map((lab) => ({ ...lab, workstations: stations.filter((w) => w.labId === lab.id) }));
}
