/**
 * Calendar dates for a hospital in India.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date: between midnight
 * and 05:30 in India it is still "yesterday", which put night admissions on
 * the wrong day (and on the 1st of a month, in the wrong monthly report).
 *
 * No imports: safe for server code and "use client" components alike.
 */

const IST_OFFSET_MS = 330 * 60_000;

/** YYYY-MM-DD in India Standard Time (server side), shifted by whole days. */
export function istDate(dayOffset = 0, now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

/** Current year in India Standard Time. */
export const istYear = (now = new Date()) => Number(istDate(0, now).slice(0, 4));

/** YYYY-MM-DD in the device's own time zone (browser side), shifted by whole days. */
export function localDate(dayOffset = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
