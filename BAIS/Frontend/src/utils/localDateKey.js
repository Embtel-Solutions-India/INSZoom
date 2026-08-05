// YYYY-MM-DD for a Date in the BROWSER'S LOCAL timezone. Deliberately not
// `date.toISOString().slice(0, 10)` — that extracts the UTC calendar day,
// which silently shifts a day backward/forward from the date the user
// actually sees highlighted on the calendar in any timezone other than UTC
// (e.g. local midnight in Asia/Calcutta, UTC+5:30, is still the previous day
// in UTC). Calendar grid cells and slot instants must use the same
// (local-day) key or availability never lines up.
export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
