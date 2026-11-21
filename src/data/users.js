export async function findByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}

/** Inside a transaction: makes a second transaction for the same user wait until this one ends. */
export async function lockForUpdate(db, id) {
  await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
}
