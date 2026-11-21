// How dates look on screen. The server sends YYYY-MM-DD; noon avoids any time-zone edge.
export const readableDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export const longDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/** The weekday before (step -1) or after (step 1) a date; the labs are open on weekdays only. */
export function weekdayFrom(date, step) {
  const d = new Date(`${date}T12:00:00`);
  do d.setDate(d.getDate() + step); while (isWeekend(d));
  return isoDate(d);
}

/** Today, or the next Monday at a weekend. */
export function firstOpenDay() {
  const d = new Date();
  while (isWeekend(d)) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/** Rows grouped by a key, in the order the rows came (the server already sorts them). */
export function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/** A small element with a class and text, so pages never build HTML from strings. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
