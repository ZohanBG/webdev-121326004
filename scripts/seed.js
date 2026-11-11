// Development data: one student, one staff member, three labs (one with no workstations).
//   npm run seed
// Both accounts use SEED_PASSWORD from .env. Runs only on a database with no users yet.
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { createPool, transaction } from '../src/data/db.js';

export const USERS = [
  { email: 'student@labspot.test', role: 'student' },
  { email: 'staff@labspot.test', role: 'staff' },
];

export const LABS = [
  {
    name: 'Networks Lab',
    room: '2140',
    workstations: [
      { label: 'NL-01', features: ['quiet'] },
      { label: 'NL-02', features: ['dual-monitor'] },
      { label: 'NL-03', features: ['quiet', 'dual-monitor'] },
      { label: 'NL-04', features: [], inService: false },
    ],
  },
  {
    name: 'GPU Lab',
    room: '1418',
    workstations: [
      { label: 'GL-01', features: ['gpu'] },
      { label: 'GL-02', features: ['gpu', 'dual-monitor'] },
    ],
  },
  // no workstations yet: the lab that AC-25 deletes by hand
  { name: 'Project Room', room: '3302', workstations: [] },
];

export async function seed(db, { password }) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('SEED_PASSWORD must be set in .env and be at least 10 characters long.');
  }
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return { skipped: true };

  const hash = await bcrypt.hash(password, 10);
  return transaction(db, async (conn) => {
    for (const user of USERS) {
      await conn.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)', [user.email, hash, user.role]);
    }
    let workstations = 0;
    for (const lab of LABS) {
      const { rows: [{ id }] } = await conn.query('INSERT INTO labs (name, room) VALUES ($1, $2) RETURNING id', [lab.name, lab.room]);
      for (const ws of lab.workstations) {
        await conn.query(
          'INSERT INTO workstations (lab_id, label, features, in_service) VALUES ($1, $2, $3, $4)',
          [id, ws.label, ws.features, ws.inService ?? true],
        );
        workstations++;
      }
    }
    return { skipped: false, users: USERS.length, labs: LABS.length, workstations };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  seed(pool, { password: process.env.SEED_PASSWORD })
    .then((r) => console.log(r.skipped
      ? 'The database already has users: seed skipped.'
      : `Seeded ${r.users} users (${USERS.map((u) => u.email).join(', ')}), ${r.labs} labs, ${r.workstations} workstations.`))
    .catch((error) => {
      console.error(`Seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
