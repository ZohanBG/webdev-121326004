export async function countSince(db, userId, since) {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM suggestion_requests WHERE user_id = $1 AND created_at >= $2',
    [userId, since],
  );
  return rows[0].n;
}

export async function record(db, { userId, outcome, at }) {
  await db.query('INSERT INTO suggestion_requests (user_id, outcome, created_at) VALUES ($1, $2, $3)', [userId, outcome, at]);
}
