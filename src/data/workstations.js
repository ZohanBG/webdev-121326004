const COLUMNS = 'w.id, w.lab_id AS "labId", w.label, w.features, w.in_service AS "inService"';

export async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM workstations w WHERE w.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Workstations in service, with their lab, ordered by lab name and label. */
export async function listActiveWithLabs(db) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, l.name AS "labName", l.room AS "labRoom"
       FROM workstations w JOIN labs l ON l.id = w.lab_id
      WHERE w.in_service
      ORDER BY l.name, w.label`,
  );
  return rows;
}

/** Every workstation, in service or not, ordered by label. */
export async function listAll(db) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM workstations w ORDER BY w.label`);
  return rows;
}

export async function insert(db, { labId, label, features }) {
  const { rows } = await db.query(
    `INSERT INTO workstations AS w (lab_id, label, features) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [labId, label, features],
  );
  return rows[0];
}

/** Changes features and/or in_service; a null value leaves that column as it is. */
export async function update(db, id, { features = null, inService = null }) {
  const { rows } = await db.query(
    `UPDATE workstations w
        SET features = COALESCE($2::text[], w.features), in_service = COALESCE($3::boolean, w.in_service)
      WHERE w.id = $1
      RETURNING ${COLUMNS}`,
    [id, features, inService],
  );
  return rows[0] ?? null;
}
