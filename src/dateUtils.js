// Converts a Date to a 'YYYY-MM-DD' string using its LOCAL calendar
// components (getFullYear/getMonth/getDate) — never toISOString(), which
// converts to UTC first. For a Date representing local midnight, that UTC
// conversion silently shifts the date back a day in any timezone ahead of
// UTC (e.g. Australia, UTC+10), because local midnight is already the
// previous day in UTC terms.
//
// Deliberately built from the plain numeric getters rather than
// toLocaleDateString() + string parsing: the getters are pure ECMAScript
// with spec-guaranteed behavior, whereas toLocaleDateString()'s exact output
// format is implementation-defined per the Intl spec — usually stable for a
// given locale, but not a contract worth depending on for something this
// load-bearing.
export function toLocalDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
