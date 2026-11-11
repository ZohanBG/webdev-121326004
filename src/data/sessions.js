// `id` is the SHA-256 of the cookie value; the cookie value itself is never stored.

export async function insert(db, { id, userId, expiresAt }) {
  await db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expiresAt]);
}

export async function findUser(db, id) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  return rows[0] ?? null;
}

export async function remove(db, id) {
  await db.query('DELETE FROM sessions WHERE id = $1', [id]);
}
