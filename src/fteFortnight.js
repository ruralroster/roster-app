// The FTE cap: once someone has been allocated their FTE's worth of hours
// in a pay fortnight, they can't be picked for more in it. Full time is 44
// hours a week, so 88 a fortnight at 1.0 FTE (70.4 at 0.8). Hours come from
// shift lengths. The Planner and the Day view both check it. A volunteer
// can still be booked past it (an extra shift they asked for), with a
// warning. Pure, so it can be unit tested.

import { DEFAULT_FTE } from './availabilityUtils';
import { addDays, intervalOn } from './plannerUtils';

export const FULL_TIME_HOURS_PER_WEEK = 44;
// A leave day with no shift on it counts as an average day: a fifth of the
// full-time week.
const LEAVE_DAY_HOURS = FULL_TIME_HOURS_PER_WEEK / 5;

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

// Hours booked for staffId from fromStr to toStr. bookings: staff_assignments
// rows with { staff_id, date, shift_id, on_call, leave_code, shifts: {
// start_time, end_time } }. One shift over two session cards counts once;
// on-call cards don't count (on call isn't rostered hours); leave counts its
// shift's length, or an average day.
export function hoursBooked(staffId, fromStr, toStr, bookings) {
  const seen = new Set();
  let hours = 0;
  for (const b of bookings) {
    if (b.staff_id !== staffId || b.date < fromStr || b.date > toStr || b.on_call) continue;
    const key = `${b.date}|${b.shift_id || (b.leave_code ? 'leave' : '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const length = shiftHours(b.date, b.shifts?.start_time, b.shifts?.end_time);
    hours += length || (b.leave_code ? LEAVE_DAY_HOURS : 0);
  }
  return hours;
}

// Hours booked in dateStr's pay fortnight, against the target.
export function fortnightLoad(staff, dateStr, bookings) {
  const { from, to } = payFortnightRange(dateStr);
  return { hours: hoursBooked(staff.staff_id, from, to, bookings), target: fortnightTargetHours(staff.fte) };
}

// True once `staff` has their FTE's hours for dateStr's pay fortnight.
export function fteFull(staff, dateStr, bookings) {
  if (!staff) return false;
  const { hours, target } = fortnightLoad(staff, dateStr, bookings);
  return hours >= target - 0.01;
}

export const formatHours = (h) => (Number.isInteger(Math.round(h * 10) / 10) ? String(Math.round(h)) : h.toFixed(1));

export const FTE_FULL_LABEL = 'FTE full this fortnight';
