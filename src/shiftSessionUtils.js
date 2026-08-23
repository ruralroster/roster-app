// Classifies a shift into which part(s) of the day it covers, for grouping
// assignments into Morning / Afternoon / Night Allocations sections (officer
// Day view, staff Day view). Driven entirely by the shift's actual
// start/end times against these three fixed windows — a shift's nominal
// `session` label (AM/PM/full/night/evening) is just a hint set at shift
// creation and isn't consulted here, so a mislabeled or "Whole Day" shift
// still lands correctly based on when it actually runs. A shift can belong
// to more than one bucket (e.g. a long day running 09:00-20:30 covers both
// Afternoon and Night), so this returns an array, not a single label.
//
// Note: Morning ends at 12:00 and Afternoon starts at 12:30 — the 30
// minutes between them belongs to neither section by design. An activity
// scheduled entirely within that gap won't show under any section.
//
// Minutes-since-midnight, not raw time strings — Postgres `time` values can
// come back from Supabase as "08:00:00", "08:00:00.000000", or occasionally
// other precisions depending on how they were written, and comparing those
// strings directly (as this used to) is only reliable when every value
// happens to share the same format. A card whose end_time came back with
// trailing zero-microseconds ("08:00:00.000000") would compare as *greater
// than* the bare "08:00:00" boundary below, despite being the exact same
// time — wrongly pulling an overnight shift ending exactly on a boundary
// into the wrong section. Parsing to minutes and comparing numbers
// sidesteps the whole class of bug.
function toMinutes(t) {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

const MORNING_START = toMinutes('09:00');
const MORNING_END = toMinutes('12:00');
const AFTERNOON_START = toMinutes('12:30');
const AFTERNOON_END = toMinutes('18:00');
const NIGHT_START = toMinutes('20:00');
const NIGHT_END = toMinutes('08:00');

export const SESSION_GROUP_ORDER = ['morning', 'afternoon', 'night'];

// Fixed defaults for the Add Activity form's Session picker — deliberately
// hardcoded to match the windows above exactly (Whole Day spans Morning
// through Afternoon, including the gap between them), rather than derived
// from whatever shift happens to be tagged with that session, whose times
// aren't guaranteed to line up.
export const SESSION_DEFAULT_TIMES = {
  full: { start: '09:00', end: '18:00' },
  AM: { start: '09:00', end: '12:00' },
  PM: { start: '12:30', end: '18:00' },
  night: { start: '20:00', end: '08:00' },
};

export const SESSION_GROUP_LABELS = {
  morning: 'Morning Allocations',
  afternoon: 'Afternoon Allocations',
  night: 'Night Allocations',
};

// Splits a possibly-midnight-wrapping [start, end) range (end <= start
// means it wraps, e.g. a Night shift 20:00-08:00 or the Night window
// itself) into one or two plain, non-wrapping [start, end) segments on a
// single 0-1440 minute number line — e.g. 20:00-08:00 becomes
// [1200, 1440) and [0, 480). A same-day range is returned as-is, as a
// single segment.
function toSegments(start, end) {
  if (end > start) return [[start, end]];
  return [[start, 1440], [0, end]];
}

// Half-open-interval overlap test — [start, end) vs [windowStart, windowEnd)
// — so a range ending exactly at another's start doesn't falsely overlap it.
function segmentsOverlap(a, b) {
  return a.some(([aStart, aEnd]) => b.some(([bStart, bEnd]) => aStart < bEnd && aEnd > bStart));
}

// Same wraparound handling applies to the window itself now that Night has
// an explicit end (20:00-08:00, not just "anything after 20:00") — so
// windows are decomposed into segments exactly like shifts are, and tested
// pairwise, rather than special-casing "the shift wraps" vs "the window
// wraps" separately.
function overlapsWindow(shiftSegments, windowStart, windowEnd) {
  return segmentsOverlap(shiftSegments, toSegments(windowStart, windowEnd));
}

export function getSessionGroups(shift) {
  if (!shift) return [];
  const { start_time, end_time } = shift;
  if (!start_time || !end_time) return [];

  const shiftSegments = toSegments(toMinutes(start_time), toMinutes(end_time));
  const groups = new Set();

  if (overlapsWindow(shiftSegments, MORNING_START, MORNING_END)) groups.add('morning');
  if (overlapsWindow(shiftSegments, AFTERNOON_START, AFTERNOON_END)) groups.add('afternoon');
  if (overlapsWindow(shiftSegments, NIGHT_START, NIGHT_END)) groups.add('night');

  return SESSION_GROUP_ORDER.filter(g => groups.has(g));
}
