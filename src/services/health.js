// Is the app able to do its work? It is when the database answers a query within the time limit.
// The answer never carries details (versions, hosts, error text); the log gets the error's code only.
import { ping } from '../data/db.js';

export const HEALTH_TIMEOUT_MS = 5000;

export const HEALTHY = { status: 'ok', db: 'ok' };
export const DOWN = { status: 'error', db: 'down' };

/** Resolves to { ok, body }: HEALTHY when the database answered in time, DOWN otherwise. */
export async function checkHealth(db, { timeoutMs = HEALTH_TIMEOUT_MS, log = console.error } = {}) {
  let timer;
  const tooSlow = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('no answer in time'), { code: 'TIMEOUT' })), timeoutMs);
  });
  try {
    await Promise.race([ping(db), tooSlow]);
    return { ok: true, body: HEALTHY };
  } catch (error) {
    log(`health: database down (${error.code ?? error.name})`);
    return { ok: false, body: DOWN };
  } finally {
    clearTimeout(timer);
  }
}
