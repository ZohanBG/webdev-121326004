// The one place that knows how to reach the database.
// Every data function takes `db`: a pg Pool in the app, a PGlite instance in tests.
// Both answer `db.query(text, params)` with `{ rows }`.
import pg from 'pg';

/** How long a new connection may take before the query fails, so a database that does not answer never hangs a request. */
export const CONNECT_TIMEOUT_MS = 5000;

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  // An idle connection the database closes (Neon does when its compute pauses) emits 'error' on the pool;
  // without a listener that would crash the app. The pool replaces the connection on the next query.
  // Logged by code only: a message can contain the host.
  pool.on('error', (error) => console.error(`database: idle connection lost (${error.code ?? error.name})`));
  return pool;
}

/** The cheapest query there is: answers when the database does. Used by GET /health. */
export async function ping(db) {
  await db.query('SELECT 1');
}

/**
 * Runs `fn` on one connection, for work that needs a transaction or several statements.
 * `exec` runs SQL that may hold several statements and takes no parameters.
 */
export async function withConnection(db, fn) {
  if (typeof db.exec === 'function') {
    // PGlite: a single connection already
    return fn({ query: (text, params) => db.query(text, params), exec: (text) => db.exec(text) });
  }
  const client = await db.connect();
  try {
    return await fn({ query: (text, params) => client.query(text, params), exec: (text) => client.query(text) });
  } finally {
    client.release();
  }
}

/** Runs `fn` inside BEGIN/COMMIT, rolling back on any error. */
export async function transaction(db, fn) {
  if (typeof db.transaction === 'function') {
    // PGlite has one connection: its own transaction() holds it, so concurrent calls wait their turn
    // instead of running their statements inside this transaction.
    return db.transaction((tx) => fn({ query: (text, params) => tx.query(text, params), exec: (text) => tx.exec(text) }));
  }
  return withConnection(db, async (conn) => {
    await conn.exec('BEGIN');
    try {
      const result = await fn(conn);
      await conn.exec('COMMIT');
      return result;
    } catch (error) {
      await conn.exec('ROLLBACK');
      throw error;
    }
  });
}
