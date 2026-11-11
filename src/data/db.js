// The one place that knows how to reach the database.
// Every data function takes `db`: a pg Pool in the app, a PGlite instance in tests.
// Both answer `db.query(text, params)` with `{ rows }`.
import pg from 'pg';

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  return new pg.Pool({ connectionString: url });
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
