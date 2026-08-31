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

// Default windows, used for any department that hasn't customized them
// (see migrations/2026-08-31_department_session_times.sql — every existing
// department is seeded with exactly these values, so nothing changes until
// an officer edits them in Settings) and as the fallback for call sites
// that don't have a department row handy.
export const DEFAULT_SESSION_BOUNDARIES = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '12:30',
  afternoonEnd: '18:00',
  nightStart: '20:00',
  nightEnd: '08:00',
};

// Reads the six boundary columns off a `departments` row, falling back to
// the default for any that are null — e.g. a department created before
// migrations/2026-08-31_department_session_times.sql ran, or `department`
// not loaded yet.
export function getDepartmentSessionBoundaries(department) {
  return {
    morningStart: department?.morning_start?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.morningStart,
    morningEnd: department?.morning_end?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.morningEnd,
    afternoonStart: department?.afternoon_start?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.afternoonStart,
    afternoonEnd: department?.afternoon_end?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.afternoonEnd,
    nightStart: department?.night_start?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.nightStart,
    nightEnd: department?.night_end?.slice(0, 5) || DEFAULT_SESSION_BOUNDARIES.nightEnd,
  };
}

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

// `boundaries` defaults to DEFAULT_SESSION_BOUNDARIES for call sites that
// don't have a department row handy — pass getDepartmentSessionBoundaries
// (department) wherever one's actually available so a department's own
// customized windows are respected.
export function getSessionGroups(shift, boundaries = DEFAULT_SESSION_BOUNDARIES) {
  if (!shift) return [];
  const { start_time, end_time } = shift;
  if (!start_time || !end_time) return [];

  const shiftSegments = toSegments(toMinutes(start_time), toMinutes(end_time));
  const groups = new Set();

  if (overlapsWindow(shiftSegments, toMinutes(boundaries.morningStart), toMinutes(boundaries.morningEnd))) groups.add('morning');
  if (overlapsWindow(shiftSegments, toMinutes(boundaries.afternoonStart), toMinutes(boundaries.afternoonEnd))) groups.add('afternoon');
  if (overlapsWindow(shiftSegments, toMinutes(boundaries.nightStart), toMinutes(boundaries.nightEnd))) groups.add('night');

  return SESSION_GROUP_ORDER.filter(g => groups.has(g));
}
