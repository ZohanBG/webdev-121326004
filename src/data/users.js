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

export async function findById(db, id) {
  const { rows } = await db.query('SELECT id, email, role, password_hash FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function insert(db, { email, role = 'student' }) {
  const { rows } = await db.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id, email, role, password_hash', [email, role]);
  return rows[0];
}

/** null removes the password: the account then signs in only through a linked provider. */
export async function setPasswordHash(db, id, hash) {
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
}
