import { describe, test, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../scripts/migrate.js';
import { seed } from '../scripts/seed.js';

let db;
afterEach(async () => {
  await db?.close();
});

describe('migrations', () => {
  test('apply to an empty database, and a second run applies nothing', async () => {
    db = new PGlite();
    const first = await migrate(db);
    expect(first).toContain('001_users_labs_sessions.sql');
    expect(await migrate(db)).toEqual([]);

    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual(['labs', 'schema_migrations', 'sessions', 'users', 'workstations']);
  });

  test('a workstation feature outside the fixed list is refused by the database', async () => {
    db = new PGlite();
    await migrate(db);
    const { rows: [lab] } = await db.query("INSERT INTO labs (name, room) VALUES ('Lab', '1') RETURNING id");
    await expect(
      db.query("INSERT INTO workstations (lab_id, label, features) VALUES ($1, 'X-1', ARRAY['laser'])", [lab.id]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('seed', () => {
  test('creates two users, three labs and six workstations, and runs only once', async () => {
    db = new PGlite();
    await migrate(db);
    expect(await seed(db, { password: 'long-enough-1' })).toEqual({ skipped: false, users: 2, labs: 3, workstations: 6 });
    expect(await seed(db, { password: 'long-enough-1' })).toEqual({ skipped: true });
  });

  test('refuses a missing or short password', async () => {
    db = new PGlite();
    await migrate(db);
    await expect(seed(db, { password: undefined })).rejects.toThrow(/SEED_PASSWORD/);
    await expect(seed(db, { password: 'short' })).rejects.toThrow(/at least 10/);
  });
});
