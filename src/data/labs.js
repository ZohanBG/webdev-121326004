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
