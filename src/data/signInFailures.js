// Failed sign-ins per email and address (migration 007). The rule that uses them is in src/services/auth.js.

export async function countSince(db, { email, ip, since }) {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM sign_in_failures WHERE email = $1 AND ip = $2 AND failed_at > $3',
    [email, ip, since],
  );
  return rows[0].n;
}

export async function insert(db, { email, ip, at }) {
  await db.query('INSERT INTO sign_in_failures (email, ip, failed_at) VALUES ($1, $2, $3)', [email, ip, at]);
}

/** A successful sign-in starts the count again for that email and address. */
export async function clear(db, { email, ip }) {
  await db.query('DELETE FROM sign_in_failures WHERE email = $1 AND ip = $2', [email, ip]);
}

/** Failures older than the window no longer count for anyone, so they are not kept. */
export async function removeOlderThan(db, before) {
  await db.query('DELETE FROM sign_in_failures WHERE failed_at <= $1', [before]);
}
