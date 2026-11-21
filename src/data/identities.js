/** The user a provider account is linked to, or null. */
export async function findUser(db, provider, accountId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, u.password_hash
       FROM identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.provider_account_id = $2`,
    [provider, accountId],
  );
  return rows[0] ?? null;
}

export async function insert(db, { userId, provider, accountId }) {
  await db.query('INSERT INTO identities (user_id, provider, provider_account_id) VALUES ($1, $2, $3)', [userId, provider, accountId]);
}

export async function listProviders(db, userId) {
  const { rows } = await db.query('SELECT provider FROM identities WHERE user_id = $1 ORDER BY provider', [userId]);
  return rows.map((r) => r.provider);
}
