/**
 * Converts a wall-clock time in an IANA time zone to a UTC instant, without a time zone library:
 * the equivalent of `new DateTimeOffset(local, zone.GetUtcOffset(local))`.
 */

const formatters = new Map();

/** @param {string} timeZone */
function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The zone's offset from UTC (ms) at a given instant.
 * @param {string} timeZone
 * @param {number} utcMs
 */
export function zoneOffsetMs(timeZone, utcMs) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(utcMs))
    .filter((p) => p.type !== 'literal')
    .map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * @param {string} timeZone
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number }} wall Month is 1-based.
 * @returns {Date}
 */
export function localToUtc(timeZone, { year, month, day, hour = 0, minute = 0, second = 0 }) {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Guess using the offset in force at that wall time read as UTC, then correct once for a DST change in between.
  const firstGuess = wallMs - zoneOffsetMs(timeZone, wallMs);
  return new Date(wallMs - zoneOffsetMs(timeZone, firstGuess));
}
