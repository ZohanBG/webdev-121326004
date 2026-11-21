// Shared test setup: a fresh in-process PostgreSQL (PGlite) per test file, and the real app on a random port.
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { migrate } from '../scripts/migrate.js';
import { seed } from '../scripts/seed.js';

export const PASSWORD = 'test-password-123';
export const STUDENT = 'student@labspot.test';
export const STUDENT2 = 'student2@labspot.test';
export const STAFF = 'staff@labspot.test';

export async function freshDb({ seeded = true } = {}) {
  const db = new PGlite();
  await migrate(db);
  if (seeded) await seed(db, { password: PASSWORD });
  return db;
}

/** The user as the session gives it to a service: { id, email, role }. */
export async function userByEmail(db, email) {
  const { rows } = await db.query('SELECT id, email, role FROM users WHERE email = $1', [email]);
  return rows[0];
}

/** Seeded workstations by label, e.g. ws.NL01 is the id of NL-01. NL-04 is out of service. */
export async function workstationIds(db) {
  const { rows } = await db.query('SELECT id, label FROM workstations');
  return Object.fromEntries(rows.map((r) => [r.label.replace('-', ''), r.id]));
}

export async function startApp(db, options = {}) {
  const app = createApp({ db, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

/** Signs in over HTTP; returns the response and the cookie to send back ("name=value"), if any. */
export async function login(base, email = STUDENT, password = PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  return { res, setCookie, cookie: setCookie ? setCookie.split(';')[0] : null };
}
