// Classifies a shift into which part(s) of the day it covers, for grouping
// assignments into Morning / Afternoon / Night Allocations sections (officer
// Day view, staff Day view). Driven entirely by the shift's actual
// start/end times against these three fixed windows — a shift's nominal
// `session` label (AM/PM/full/night/evening) is just a hint set at shift
// creation and isn't consulted here, so a mislabeled or "Whole Day" shift
// still lands correctly based on when it actually runs. A shift can belong
// to more than one bucket (e.g. a long day running 08:00-20:30 covers both
// Afternoon and Night), so this returns an array, not a single label.
// Minutes-since-midnight, not raw time strings — Postgres `time` values can
// come back from Supabase as "08:00:00", "08:00:00.000000", or occasionally
// other precisions depending on how they were written, and comparing those
// strings directly (as this used to) is only reliable when every value
// happens to share the same format. A card whose end_time came back with
// trailing zero-microseconds ("08:00:00.000000") would compare as *greater
// than* the bare "08:00:00" boundary below, despite being the exact same
// time — wrongly pulling an overnight shift ending at 8am into Morning.
// Parsing to minutes and comparing numbers sidesteps the whole class of bug.
function toMinutes(t) {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

const MORNING_START = toMinutes('08:00');
const MORNING_END = toMinutes('12:00');
const AFTERNOON_START = toMinutes('12:00');
const AFTERNOON_END = toMinutes('18:00');
const NIGHT_START = toMinutes('20:00');

export const SESSION_GROUP_ORDER = ['morning', 'afternoon', 'night'];

// Fixed defaults for the Add Activity form's Session picker — deliberately
// hardcoded to match the windows above exactly (Whole Day = Morning +
// Afternoon, nothing else), rather than derived from whatever shift happens
// to be tagged with that session, whose times aren't guaranteed to line up.
export const SESSION_DEFAULT_TIMES = {
  full: { start: '08:00', end: '18:00' },
  AM: { start: '08:00', end: '12:00' },
  PM: { start: '12:00', end: '18:00' },
  night: { start: '20:00', end: '07:00' },
};

export const SESSION_GROUP_LABELS = {
  morning: 'Morning Allocations',
  afternoon: 'Afternoon Allocations',
  night: 'Night Allocations',
};

// Half-open-interval overlap test — [start, end) vs [windowStart, windowEnd)
// — so a shift ending exactly at a window's start doesn't falsely overlap it.
function overlapsWindow(start, end, windowStart, windowEnd) {
  return start < windowEnd && end > windowStart;
}

export function getSessionGroups(shift) {
  if (!shift) return [];
  const { start_time, end_time } = shift;
  if (!start_time || !end_time) return [];

  const start = toMinutes(start_time);
  const end = toMinutes(end_time);

  // Wraps past midnight (e.g. a Night shift 20:00-07:00) — end <= start.
  const overnight = end <= start;
  const groups = new Set();

  if (overnight) {
    // Always covers Night by definition. Morning/Afternoon are checked on
    // both sides of midnight independently — the day it starts (e.g.
    // 14:00-06:00 starts within the Afternoon window) and the day it hands
    // over (e.g. 22:00-09:00 hands over after Morning has started; 22:30-
    // 08:00 does not, since it ends exactly when Morning begins).
    groups.add('night');
    if (start < MORNING_END) groups.add('morning');
    if (end > MORNING_START) groups.add('morning');
    if (start < AFTERNOON_END) groups.add('afternoon');
    if (end > AFTERNOON_START) groups.add('afternoon');
  } else {
    if (overlapsWindow(start, end, MORNING_START, MORNING_END)) groups.add('morning');
    if (overlapsWindow(start, end, AFTERNOON_START, AFTERNOON_END)) groups.add('afternoon');
    if (end > NIGHT_START) groups.add('night');
  }

  return SESSION_GROUP_ORDER.filter(g => groups.has(g));
}
