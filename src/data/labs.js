/** Every lab with the number of its workstations that are in service. */
export async function listWithActiveCounts(db) {
  const { rows } = await db.query(
    `SELECT l.id, l.name, l.room,
            count(w.id) FILTER (WHERE w.in_service)::int AS "activeWorkstations"
       FROM labs l
       LEFT JOIN workstations w ON w.lab_id = l.id
      GROUP BY l.id
      ORDER BY l.name`,
  );
  return rows;
}

export async function listAll(db) {
  const { rows } = await db.query('SELECT id, name, room FROM labs ORDER BY name');
  return rows;
}

export async function findById(db, id) {
  const { rows } = await db.query('SELECT id, name, room FROM labs WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function insert(db, { name, room }) {
  const { rows } = await db.query('INSERT INTO labs (name, room) VALUES ($1, $2) RETURNING id, name, room', [name, room]);
  return rows[0];
}
