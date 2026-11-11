import * as labs from '../data/labs.js';
import { NotSignedIn } from './errors.js';

/** The labs any signed-in user may see. The route checks the session first; this guards every other caller (MCP). */
export async function listLabs(db, user) {
  if (!user) throw new NotSignedIn();
  return labs.listWithActiveCounts(db);
}
