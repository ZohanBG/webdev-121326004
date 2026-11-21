// Dates leave the database as 'YYYY-MM-DD' text, so no time zone can shift them on the way.
const COLUMNS = `b.id, b.user_id AS "userId", b.workstation_id AS "workstationId",
  to_char(b.date, 'YYYY-MM-DD') AS date, b.block, b.status, b.cancelled_by AS "cancelledBy"`;

export async function insert(db, { userId, workstationId, date, block }) {
  const { rows } = await db.query(
    `INSERT INTO bookings (user_id, workstation_id, date, block) VALUES ($1, $2, $3, $4)
     RETURNING id, user_id AS "userId", workstation_id AS "workstationId", to_char(date, 'YYYY-MM-DD') AS date, block, status`,
    [userId, workstationId, date, block],
  );
  return rows[0];
}

export async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM bookings b WHERE b.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findActiveAt(db, { workstationId, date, block }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM bookings b WHERE b.workstation_id = $1 AND b.date = $2 AND b.block = $3 AND b.status = 'active'`,
    [workstationId, date, block],
  );
  return rows[0] ?? null;
}

export async function findActiveForUserAt(db, userId, date, block) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM bookings b WHERE b.user_id = $1 AND b.date = $2 AND b.block = $3 AND b.status = 'active'`,
    [userId, date, block],
  );
  return rows[0] ?? null;
}

/** A user's active bookings from a date on, with lab and workstation names, soonest first. */
export async function listActiveForUserFrom(db, userId, fromDate) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, w.label AS workstation, l.name AS lab
       FROM bookings b JOIN workstations w ON w.id = b.workstation_id JOIN labs l ON l.id = w.lab_id
      WHERE b.user_id = $1 AND b.date >= $2 AND b.status = 'active'
      ORDER BY b.date, b.block`,
    [userId, fromDate],
  );
  return rows;
}

/** For "my bookings": a user's bookings from a date on that are active, or that someone else (staff) cancelled. */
export async function listForUserFrom(db, userId, fromDate) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, w.label AS workstation, l.name AS lab
       FROM bookings b JOIN workstations w ON w.id = b.workstation_id JOIN labs l ON l.id = w.lab_id
      WHERE b.user_id = $1 AND b.date >= $2
        AND (b.status = 'active' OR b.cancelled_by <> b.user_id)
      ORDER BY b.date, b.block`,
    [userId, fromDate],
  );
  return rows;
}

export async function listActiveForWorkstationFrom(db, workstationId, fromDate) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM bookings b WHERE b.workstation_id = $1 AND b.date >= $2 AND b.status = 'active'`,
    [workstationId, fromDate],
  );
  return rows;
}

/** For staff: every active booking on a date, with lab, workstation and the student's email. */
export async function listActiveOnDateWithPeople(db, date) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, w.label AS workstation, l.name AS lab, u.email
       FROM bookings b
       JOIN workstations w ON w.id = b.workstation_id
       JOIN labs l ON l.id = w.lab_id
       JOIN users u ON u.id = b.user_id
      WHERE b.date = $1 AND b.status = 'active'
      ORDER BY l.name, w.label, b.block`,
    [date],
  );
  return rows;
}

/** Every active booking on one date: who holds which workstation in which block. */
export async function listActiveOnDate(db, date) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM bookings b WHERE b.date = $1 AND b.status = 'active'`, [date]);
  return rows;
}

/** Cancels an active booking. Returns null when it was not active any more. */
export async function cancel(db, id, cancelledBy) {
  const { rows } = await db.query(
    `UPDATE bookings b SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
      WHERE b.id = $1 AND b.status = 'active'
      RETURNING ${COLUMNS}`,
    [id, cancelledBy],
  );
  return rows[0] ?? null;
}
