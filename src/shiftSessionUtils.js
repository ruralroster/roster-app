// Classifies a shift into which part(s) of the day it covers, for grouping
// assignments into Morning / Afternoon / Night Allocations sections (officer
// Day view, staff Day view). Driven entirely by the shift's actual
// start/end times against these three fixed windows — a shift's nominal
// `session` label (AM/PM/full/night/evening) is just a hint set at shift
// creation and isn't consulted here, so a mislabeled or "Whole Day" shift
// still lands correctly based on when it actually runs. A shift can belong
// to more than one bucket (e.g. a long day running 08:00-20:30 covers both
// Afternoon and Night), so this returns an array, not a single label.
const MORNING_START = '08:00:00';
const MORNING_END = '12:00:00';
const AFTERNOON_START = '12:00:00';
const AFTERNOON_END = '18:00:00';
const NIGHT_START = '20:00:00';

export const SESSION_GROUP_ORDER = ['morning', 'afternoon', 'night'];

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
  const { start_time: start, end_time: end } = shift;
  if (!start || !end) return [];

  // Wraps past midnight (e.g. a Night shift 20:00-07:00) — end <= start.
  const overnight = end <= start;
  const groups = new Set();

  if (overnight) {
    // Always covers Night by definition; also covers Morning if it hands
    // over after the Morning window has started the next day.
    groups.add('night');
    if (end > MORNING_START) groups.add('morning');
  } else {
    if (overlapsWindow(start, end, MORNING_START, MORNING_END)) groups.add('morning');
    if (overlapsWindow(start, end, AFTERNOON_START, AFTERNOON_END)) groups.add('afternoon');
    if (end > NIGHT_START) groups.add('night');
  }

  return SESSION_GROUP_ORDER.filter(g => groups.has(g));
}
