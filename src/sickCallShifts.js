// NOTIFY SICK — WHICH SHIFTS CAN BE CALLED IN SICK FOR
//
// The Notify Sick button is live whenever the staff member has a shift
// that's under way now or starts within the next 12 hours (8pm for an 8am
// start), so someone can call in the evening before an early start but
// not days ahead: that's leave, for the officer. More than one (an AM and a PM
// session, or tonight and tomorrow morning) and they tick which ones.
//
// Times come from the card first, then the shift — the same order as
// getSickCallRecipients. An end at or before the start runs overnight. An
// assignment with no times at all counts as its whole date. Leave rows
// (leave_code set) aren't shifts.

export const SICK_CALL_WINDOW_HOURS = 12;

const hhmm = (t) => (t ? t.slice(0, 5) : null);

// Local Date for dateStr ("2026-10-23") at timeStr ("08:00").
const at = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr}:00`);

export function assignmentWindow(assignment) {
  const startTime = hhmm(assignment.theatre_activities?.start_time) || hhmm(assignment.shifts?.start_time);
  const endTime = hhmm(assignment.theatre_activities?.end_time) || hhmm(assignment.shifts?.end_time);
  const start = at(assignment.date, startTime && endTime ? startTime : '00:00');
  const end = startTime && endTime ? at(assignment.date, endTime) : at(assignment.date, '00:00');
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end, startTime: startTime && endTime ? startTime : null, endTime: startTime && endTime ? endTime : null };
}

// assignments: staff_assignments rows (with locations, shifts and
// theatre_activities times) for yesterday through tomorrow. Returns
// [{ assignment, start, end, startTime, endTime }] soonest first.
export function sickCallShiftsInWindow(assignments, now = new Date()) {
  const windowEnd = new Date(now.getTime() + SICK_CALL_WINDOW_HOURS * 60 * 60 * 1000);
  return (assignments || [])
    .filter(a => !a.leave_code)
    .map(a => ({ assignment: a, ...assignmentWindow(a) }))
    .filter(s => s.end > now && s.start <= windowEnd)
    .sort((x, y) => x.start - y.start);
}

// "Fri, 23 Oct — Theatre 1, AM (08:00–12:30)"
export function describeSickCallShift(shift) {
  const { assignment, startTime, endTime } = shift;
  const date = at(assignment.date, '00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const where = [assignment.locations?.name, assignment.shifts?.name].filter(Boolean).join(', ');
  const times = startTime ? ` (${startTime}–${endTime})` : '';
  return `${date}${where ? ` — ${where}` : ''}${times}`;
}
