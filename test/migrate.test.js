import { describe, test, expect, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../scripts/migrate.js';
import { seed, LABS } from '../scripts/seed.js';
import { FEATURE_IDS } from '../src/services/features.js';

let db;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('migrations', () => {
  test('apply to an empty database, and a second run applies nothing', async () => {
    db = new PGlite();
    const first = await migrate(db);
    expect(first).toEqual(['001_users_labs_sessions.sql', '002_bookings.sql', '003_suggestion_requests.sql', '004_identities.sql', '005_gemini_outcomes.sql', '006_feature_list.sql', '007_sign_in_failures.sql']);
    expect(await migrate(db)).toEqual([]);

    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual(['bookings', 'identities', 'labs', 'oauth_attempts', 'schema_migrations', 'sessions', 'sign_in_failures', 'suggestion_requests', 'users', 'workstations']);
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

describe('the feature list', () => {
  test("the database's CHECK allows exactly the ids in src/services/features.js, and refuses any other", async () => {
    db = new PGlite();
    await migrate(db);
    const { rows: [{ def }] } = await db.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'workstations_features_check'",
    );
    const inDatabase = [...def.matchAll(/'([a-z-]+)'::text/g)].map((m) => m[1]);
    expect(inDatabase.sort()).toEqual([...FEATURE_IDS].sort());
    const { rows: [lab] } = await db.query("INSERT INTO labs (name, room) VALUES ('Lab', '1') RETURNING id");
    await expect(db.query("INSERT INTO workstations (lab_id, label, features) VALUES ($1, 'X-1', ARRAY['gpu'])", [lab.id]))
      .rejects.toThrow(/workstations_features_check/);
  });

  test('migration 006 turns an existing "gpu" into "gpu-cuda" and keeps every other feature', async () => {
    const all = join(import.meta.dirname, '..', 'migrations');
    const before006 = mkdtempSync(join(tmpdir(), 'labspot-migrations-'));
    try {
      for (const file of readdirSync(all).filter((f) => f < '006')) copyFileSync(join(all, file), join(before006, file));
      db = new PGlite();
      await migrate(db, before006);
      const { rows: [lab] } = await db.query("INSERT INTO labs (name, room) VALUES ('Lab', '1') RETURNING id");
      await db.query("INSERT INTO workstations (lab_id, label, features) VALUES ($1, 'OLD-1', ARRAY['gpu', 'quiet'])", [lab.id]);

      expect(await migrate(db, all)).toEqual(['006_feature_list.sql', '007_sign_in_failures.sql']);
      const { rows } = await db.query("SELECT features FROM workstations WHERE label = 'OLD-1'");
      expect(rows[0].features).toEqual(['gpu-cuda', 'quiet']);
    } finally {
      rmSync(before006, { recursive: true, force: true });
    }
  });

  test('every feature in the seed is on the list, and the seed keeps a lab with no workstations (AC-24, AC-25)', () => {
    const seeded = LABS.flatMap((lab) => lab.workstations.flatMap((w) => w.features));
    expect(seeded.filter((f) => !FEATURE_IDS.includes(f))).toEqual([]);
    expect(LABS.map((lab) => lab.workstations.length)).toEqual([4, 2, 0]);
  });
});

describe('bookings table', () => {
  const book = (userId, workstationId, block, date = '2026-11-19') =>
    db.query('INSERT INTO bookings (user_id, workstation_id, date, block) VALUES ($1, $2, $3, $4) RETURNING id', [userId, workstationId, date, block]);

  test('the database refuses a second active booking for the same workstation or the same student in one block', async () => {
    db = new PGlite();
    await migrate(db);
    await seed(db, { password: 'long-enough-1' });
    const { rows: [other] } = await db.query("INSERT INTO users (email, password_hash) VALUES ('two@labspot.test', 'x') RETURNING id");

    await book(1, 1, 3);
    await expect(book(other.id, 1, 3)).rejects.toThrow(/bookings_one_per_workstation/);
    await expect(book(1, 2, 3)).rejects.toThrow(/bookings_one_per_student/);
    await book(1, 2, 4); // another block is fine
  });

  test('a cancelled booking frees its slot, and must record when and by whom', async () => {
    db = new PGlite();
    await migrate(db);
    await seed(db, { password: 'long-enough-1' });
    const { rows: [first] } = await book(1, 1, 3);

    await expect(db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [first.id]))
      .rejects.toThrow(/bookings_cancellation_recorded/);
    await db.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = 1 WHERE id = $1", [first.id]);
    await book(1, 1, 3); // the same slot can be booked again
  });

  test('a block outside 1 to 6 is refused by the database', async () => {
    db = new PGlite();
    await migrate(db);
    await seed(db, { password: 'long-enough-1' });
    await expect(book(1, 1, 7)).rejects.toThrow(/check constraint/);
    await expect(book(1, 1, 0)).rejects.toThrow(/check constraint/);
  });
});

describe('seed', () => {
  test('creates three users, three labs and six workstations, and runs only once', async () => {
    db = new PGlite();
    await migrate(db);
    expect(await seed(db, { password: 'long-enough-1' })).toEqual({ skipped: false, users: 3, labs: 3, workstations: 6 });
    expect(await seed(db, { password: 'long-enough-1' })).toEqual({ skipped: true });
  });

  test('refuses a missing or short password', async () => {
    db = new PGlite();
    await migrate(db);
    await expect(seed(db, { password: undefined })).rejects.toThrow(/SEED_PASSWORD/);
    await expect(seed(db, { password: 'short' })).rejects.toThrow(/at least 10/);
  });
});
