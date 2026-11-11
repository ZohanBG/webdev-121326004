// Applies every file in migrations/ that has not run yet, in name order, one transaction each.
//   npm run migrate
// A migration that has run is never edited: write a new numbered file instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool, transaction, withConnection } from '../src/data/db.js';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

export async function migrate(db, dir = MIGRATIONS) {
  await withConnection(db, (conn) =>
    conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`),
  );
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await transaction(db, async (conn) => {
      await conn.exec(sql);
      await conn.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  migrate(pool)
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply: the database is up to date.'))
    .catch((error) => {
      console.error(`Migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
