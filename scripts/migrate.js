// Applies every file in migrations/ that has not run yet, in name order, one transaction each.
//   npm run migrate
// A migration that has run is never edited: write a new numbered file instead.
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createPool, transaction, withConnection } = require('../src/data/db');

const MIGRATIONS = join(__dirname, '..', 'migrations');

async function migrate(db, dir = MIGRATIONS) {
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

if (require.main === module) {
  const pool = createPool();
  migrate(pool)
    .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply: the database is up to date.'))
    .catch((error) => {
      console.error(`Migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { migrate };
