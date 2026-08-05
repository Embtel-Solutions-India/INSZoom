// Dependency-free IANA-timezone-aware date helpers (Node's built-in Intl/ICU
// — no luxon/moment/date-fns-tz needed). Plain Date.setHours()/getDay()
// always operate in the server PROCESS's own local timezone, not any
// specific IANA zone — so "9am-6pm working hours" computed with them is
// silently wrong (and DST-unaware) whenever the server's host timezone
// differs from the timezone those hours are actually meant to be in.

function zonedTimeOffsetMinutes(utcDate, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - utcDate.getTime()) / 60000;
}

// The absolute UTC instant that a wall-clock year/month/day/hour/minute
// represents *as observed in `timeZone`* (e.g. 9:00 on 2026-07-31 in
// "America/Los_Angeles" -> 2026-07-31T16:00:00.000Z, correctly DST-aware).
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = zonedTimeOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60000);
}

// The calendar date + day-of-week a UTC instant falls on when viewed in
// `timeZone` — NOT the server process's own local calendar day.
function zonedDateParts(utcDate, timeZone) {
  const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(utcDate).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: WEEKDAY_INDEX[parts.weekday],
  };
}

module.exports = { zonedTimeToUtc, zonedDateParts };
