export async function findByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  return rows[0] ?? null;
}
