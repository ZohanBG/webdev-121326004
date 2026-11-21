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
