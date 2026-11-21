export async function insert(db, { stateHash, codeVerifier, expiresAt }) {
  await db.query('INSERT INTO oauth_attempts (state_hash, code_verifier, expires_at) VALUES ($1, $2, $3)', [stateHash, codeVerifier, expiresAt]);
}

/** Removes the attempt and returns its verifier, if it exists and has not expired: each state works once. */
export async function take(db, stateHash, now) {
  const { rows } = await db.query(
    'DELETE FROM oauth_attempts WHERE state_hash = $1 RETURNING code_verifier AS "codeVerifier", expires_at > $2 AS fresh',
    [stateHash, now],
  );
  return rows[0]?.fresh ? rows[0].codeVerifier : null;
}
