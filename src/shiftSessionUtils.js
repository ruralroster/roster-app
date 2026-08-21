// Classifies a shift into which part(s) of the day it covers, for grouping
// assignments into Morning / Afternoon / Night Allocations sections (officer
// Day view, staff Day view). A shift can belong to more than one bucket —
// e.g. a Whole Day shift (07:30-17:30) spans both Morning and Afternoon —
// so this returns an array, not a single label.
const NOON = '12:00:00';
const EVENING_CUTOFF = '17:30:00';

export const SESSION_GROUP_ORDER = ['morning', 'afternoon', 'night'];

export const SESSION_GROUP_LABELS = {
  morning: 'Morning Allocations',
  afternoon: 'Afternoon Allocations',
  night: 'Night Allocations',
};

export function getSessionGroups(shift) {
  if (!shift) return [];
  const { session, start_time: start, end_time: end } = shift;
  // Wraps past midnight (e.g. Night shift 22:00-08:00) — end <= start.
  const overnight = Boolean(start && end && end <= start);
  const groups = new Set();

  if (session === 'AM') groups.add('morning');
  else if (session === 'PM') groups.add('afternoon');
  else if (session === 'night' || session === 'evening' || overnight) groups.add('night');
  else if (session === 'full') { groups.add('morning'); groups.add('afternoon'); }
  else {
    // Unrecognized/missing session value — fall back to raw start/end times.
    if (start && start < NOON) groups.add('morning');
    if (end && end > NOON && !overnight) groups.add('afternoon');
  }

  // Anyone working past 17:30 counts as a Night allocation too, regardless
  // of the shift's nominal session label (e.g. a PM shift that runs late).
  if (!overnight && end && end > EVENING_CUTOFF) groups.add('night');

  return SESSION_GROUP_ORDER.filter(g => groups.has(g));
}
