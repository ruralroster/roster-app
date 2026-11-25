// The FTE cap: once someone has been allocated their FTE's worth of hours
// in a pay fortnight, they can't be picked for more in it. Full time is 44
// hours a week, so 88 a fortnight at 1.0 FTE (70.4 at 0.8). Hours come from
// shift lengths. The Planner and the Day view both check it. A volunteer
// can still be booked past it (an extra shift they asked for), with a
// warning. Pure, so it can be unit tested.

import { DEFAULT_FTE } from './availabilityUtils';
import { addDays, intervalOn } from './plannerUtils';

// Full time, hours a week: 44 for doctors by default; a department can set
// its own (departments.full_time_hours_per_week, e.g. 38 for admin), which
// the officer and staff views pass in with setFullTimeHoursPerWeek when the
// department loads. A live binding: everything importing it sees the
// department's.
export let FULL_TIME_HOURS_PER_WEEK = 44;
// A leave day counts as a normal shift for the person: see leaveDayHours.
// With no shifts to average, a fifth of the full-time week.
export let LEAVE_DAY_HOURS = FULL_TIME_HOURS_PER_WEEK / 5;
export function setFullTimeHoursPerWeek(hours) {
  const h = Number(hours) > 0 ? Number(hours) : 44;
  FULL_TIME_HOURS_PER_WEEK = h;
  LEAVE_DAY_HOURS = h / 5;
}

// A known pay fortnight start (Monday); every pay fortnight is 14 days on
// from it. Same boundary as edRuleChecks' FORTNIGHT_ANCHOR.
const PAY_FORTNIGHT_ANCHOR = '2026-06-08';
const DAY_MS = 24 * 60 * 60 * 1000;

// { from, to } (YYYY-MM-DD) of the pay fortnight dateStr falls in.
export function payFortnightRange(dateStr) {
  const diff = Math.round((new Date(`${dateStr}T00:00:00`) - new Date(`${PAY_FORTNIGHT_ANCHOR}T00:00:00`)) / DAY_MS);
  const from = addDays(PAY_FORTNIGHT_ANCHOR, Math.floor(diff / 14) * 14);
  return { from, to: addDays(from, 13) };
}

export function fortnightTargetHours(fte) {
  return (fte ?? DEFAULT_FTE) * FULL_TIME_HOURS_PER_WEEK * 2;
}

export function shiftHours(dateStr, startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const { start, end } = intervalOn(dateStr, startTime, endTime);
  return (end - start) / 60;
}

// How long a leave day counts for each person: the average shift worked by
// people of the same rank in bookings (on call and leave left out), or by
// everyone if their rank has none, or LEAVE_DAY_HOURS; rounded down to a
// whole number of hours. Not the leave row's
// own shift, which can be anything (an uploaded 00:00-00:00 reads as 24 h).
// Returns staffId => hours.
export function leaveDayHours(staffList, bookings) {
  const rankOf = new Map((staffList || []).map(s => [s.staff_id, s.rank || '']));
  const seen = new Set();
  const byRank = new Map();
  const all = { total: 0, n: 0 };
  for (const b of bookings || []) {
    if (b.on_call || b.leave_code || !b.shift_id) continue;
    const key = `${b.staff_id}|${b.date}|${b.shift_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const length = shiftHours(b.date, b.shifts?.start_time, b.shifts?.end_time);
    if (!(length > 0 && length < 24)) continue;
    const rank = rankOf.get(b.staff_id) ?? '';
    const r = byRank.get(rank) || { total: 0, n: 0 };
    r.total += length; r.n += 1;
    byRank.set(rank, r);
    all.total += length; all.n += 1;
  }
  const average = new Map([...byRank].map(([rank, r]) => [rank, r.total / r.n]));
  const fallback = all.n ? all.total / all.n : LEAVE_DAY_HOURS;
  // A whole number of hours, rounded down.
  return (staffId) => Math.floor(average.get(rankOf.get(staffId) ?? '') ?? fallback);
}

// A leave block (Staff & Availability > Add leave) counts the person's FTE
// over its length: 44 hours a week x FTE, spread over every day of it, so
// two weeks at 0.5 FTE is 44 hours and at 1.0 is 88. Hours a day.
export function leaveBlockHoursPerDay(fte) {
  return Math.round(((fte ?? DEFAULT_FTE) * FULL_TIME_HOURS_PER_WEEK / 7) * 100) / 100;
}

// Hours booked for staffId from fromStr to toStr. bookings: staff_assignments
// rows with { staff_id, date, shift_id, on_call, leave_code, shifts: {
// start_time, end_time } }. One shift over two session cards counts once;
// on-call cards don't count (on call isn't rostered hours); a leave day
// counts its own leave_hours if it has them (a leave block), else
// leaveHours(staffId) (leaveDayHours), once a day.
export function hoursBooked(staffId, fromStr, toStr, bookings, leaveHours = () => LEAVE_DAY_HOURS) {
  const seen = new Set();
  let hours = 0;
  for (const b of bookings) {
    if (b.staff_id !== staffId || b.date < fromStr || b.date > toStr || b.on_call) continue;
    const key = b.leave_code ? `${b.date}|leave` : `${b.date}|${b.shift_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hours += b.leave_code
      ? (b.leave_hours != null ? Number(b.leave_hours) : leaveHours(staffId))
      : shiftHours(b.date, b.shifts?.start_time, b.shifts?.end_time);
  }
  return hours;
}

// Hours booked in dateStr's pay fortnight, against the target.
export function fortnightLoad(staff, dateStr, bookings, leaveHours) {
  const { from, to } = payFortnightRange(dateStr);
  return { hours: hoursBooked(staff.staff_id, from, to, bookings, leaveHours), target: fortnightTargetHours(staff.fte) };
}

// True once `staff` has their FTE's hours for dateStr's pay fortnight.
// FTE 0 (a casual or locum) has no cap: they're booked as needed.
export function fteFull(staff, dateStr, bookings, leaveHours) {
  if (!staff) return false;
  const { hours, target } = fortnightLoad(staff, dateStr, bookings, leaveHours);
  if (target <= 0) return false;
  return hours >= target - 0.01;
}

export const formatHours = (h) => (Number.isInteger(Math.round(h * 10) / 10) ? String(Math.round(h)) : h.toFixed(1));

export const FTE_FULL_LABEL = 'FTE full this fortnight';
