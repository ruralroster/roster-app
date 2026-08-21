// Shared FTE / availability-compliance helpers used by both the officer's
// StaffAvailabilityTab and the staff member's own Settings tab, so the two
// views always agree on thresholds and colours.

// 0.1 increments from 0.0 to 1.0, plus 0.25/0.75 (quarter-time isn't on the
// tenths grid). Built from integer hundredths to avoid float drift
// (0.1 + 0.2 !== 0.3 in JS) rather than hardcoding a literal array.
const FTE_HUNDREDTHS = new Set([25, 75]);
for (let h = 0; h <= 100; h += 10) FTE_HUNDREDTHS.add(h);
export const FTE_OPTIONS = Array.from(FTE_HUNDREDTHS).sort((a, b) => a - b).map(h => h / 100);

// Whole-tenths values read with one decimal ("1.0", "0.3", "0.0"); values
// that land between tenths (0.25, 0.75) read as-is with two decimals.
export function formatFte(fte) {
  const hundredths = Math.round(fte * 100);
  if (hundredths % 10 === 0) return (hundredths / 100).toFixed(1);
  return (hundredths / 100).toString();
}

export const DEFAULT_FTE = 1.0;
export const TARGET_FTE_MULTIPLIER = 1.25; // ideal buffer for weekend/break flexibility

// A 1.0 FTE staff member works 5 of 7 days, not every day — so their
// expected share of days-available is scaled down from the raw FTE fraction.
export const FULL_TIME_DAYS_PER_WEEK = 5;
export const DAYS_PER_WEEK = 7;
export const FTE_TO_DAY_FRACTION = FULL_TIME_DAYS_PER_WEEK / DAYS_PER_WEEK; // ~0.714

// Given how many days a staff member marked themselves available within a
// window, and their contracted FTE, classify compliance:
//   red    - available ratio is below what their FTE requires (5/7 per 1.0 FTE)
//   orange - meets that requirement but hasn't reached the 1.25x flexibility buffer
//   green  - at or above the 1.25x buffer
export function computeAvailabilityCompliance(availableDays, totalDays, fte) {
  // `??` (not `||`) so an explicit 0 FTE (deliberately no rostering
  // expectation) isn't mistaken for "unset" and bumped up to full-time.
  const effectiveFte = fte ?? DEFAULT_FTE;
  const availabilityRatio = totalDays > 0 ? availableDays / totalDays : 0;
  const requiredRatio = effectiveFte * FTE_TO_DAY_FRACTION;
  const targetRatio = requiredRatio * TARGET_FTE_MULTIPLIER;
  const multiplier = requiredRatio > 0 ? availabilityRatio / requiredRatio : 0;

  let status;
  if (effectiveFte === 0) status = 'green'; // nothing required at 0 FTE
  else if (multiplier < 1.0) status = 'red';
  else if (multiplier < TARGET_FTE_MULTIPLIER) status = 'orange';
  else status = 'green';

  return {
    availableDays,
    totalDays,
    fte: effectiveFte,
    availabilityRatio,
    requiredRatio,
    targetRatio,
    multiplier,
    status,
  };
}

export const COMPLIANCE_STYLES = {
  red: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', dot: 'bg-red-500', label: 'Insufficient' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', dot: 'bg-orange-500', label: 'Below Target' },
  green: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', dot: 'bg-green-500', label: 'On Target' },
};

// ------------------------------------------------------------------
// 3-state day model: unset (never chosen) -> available -> unavailable -> unset
// `availabilityMap` is keyed by date string ('YYYY-MM-DD') with true/false;
// a missing key means unset. Unset days are NOT treated as available.
// ------------------------------------------------------------------

export function getAvailabilityState(availabilityMap, dateStr) {
  const value = availabilityMap[dateStr];
  if (value === true) return 'available';
  if (value === false) return 'unavailable';
  return 'unset';
}

export function nextAvailabilityState(state) {
  if (state === 'unset') return 'available';
  if (state === 'available') return 'unavailable';
  return 'unset';
}

// Value to persist via toggleStaffAvailability(departmentId, staffId, date, value):
// true/false to set a state, or null to clear the record (back to unset).
export function stateToStoredValue(state) {
  if (state === 'available') return true;
  if (state === 'unavailable') return false;
  return null;
}

export const DAY_STATE_STYLES = {
  unset: {
    classes: 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100',
    title: 'Not set — tap to mark available',
  },
  available: {
    classes: 'bg-green-50 border-green-300 text-green-900 hover:bg-green-100',
    title: 'Available — tap to mark unavailable',
  },
  unavailable: {
    classes: 'bg-red-50 border-red-300 text-red-900 hover:bg-red-100',
    title: 'Unavailable — tap to clear',
  },
};

// ------------------------------------------------------------------
// Recurring unavailability: rather than a separate rules table, rules
// (standing weekday off / fortnightly off-week / leave block) are
// "materialized" as ordinary unavailable records in staff_availability
// over a rolling window — the same table every other screen already reads,
// so nothing else needs to know rules exist. The trade-off is the window
// has an edge (MATERIALIZATION_MONTHS_AHEAD) and needs periodic re-applying.
// ------------------------------------------------------------------

export const MATERIALIZATION_MONTHS_AHEAD = 12;

export function getMaterializationWindow(from = new Date()) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + MATERIALIZATION_MONTHS_AHEAD);
  return { start, end };
}

// Every occurrence of `dayOfWeek` (0=Sun..6=Sat) from startDate to endDate inclusive.
export function getDatesForWeekday(startDate, endDate, dayOfWeek) {
  const dates = [];
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7));
  while (d <= endDate) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// A 2-week recurring availability template. `selectedSlots` is a Set of
// "weekIndex-dayOfWeek" keys (weekIndex 0 = First Week, 1 = Second Week;
// dayOfWeek 0=Sun..6=Sat) — the days the staff member is regularly
// available. `anchorDate` marks the Sunday that begins "First Week" (it's
// snapped to that week's Sunday regardless of which weekday is passed).
// Every date from max(anchor, today) to endDate is classified as available
// or unavailable based on which slot of the repeating 14-day cycle it falls
// into, so the whole window gets a complete, unambiguous template.
export function getDatesForFortnightlyTemplate(anchorDate, endDate, selectedSlots) {
  const anchor = new Date(anchorDate);
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() - anchor.getDay());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const availableDates = [];
  const unavailableDates = [];

  const d = anchor > today ? new Date(anchor) : new Date(today);
  while (d <= endDate) {
    const daysSinceAnchor = Math.round((d - anchor) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(daysSinceAnchor / 7) % 2;
    const slot = `${weekIndex}-${d.getDay()}`;
    (selectedSlots.has(slot) ? availableDates : unavailableDates).push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  return { availableDates, unavailableDates };
}

// A fortnightly pattern doesn't have to run forever — someone on a 6-month
// locum shouldn't have their roster shaped 12 months out. `fortnightCount`
// (2-26) is how many 14-day cycles to apply from the anchor's Sunday; 26
// cycles = 364 days, matching the old fixed 12-month default at the top end.
export const MIN_FORTNIGHT_COUNT = 2;
export const MAX_FORTNIGHT_COUNT = 26;

export function getFortnightlyEndDate(anchorDate, fortnightCount) {
  const anchor = new Date(anchorDate);
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() - anchor.getDay());

  const end = new Date(anchor);
  end.setDate(end.getDate() + fortnightCount * 14 - 1);
  return end;
}

// Every day from startDate to endDate inclusive (for leave blocks).
export function getDatesInRange(startDate, endDate) {
  const dates = [];
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ------------------------------------------------------------------
// On-call / weekend fairness: each staff member's actual share of a duty
// type compared to their "fair" share (their FTE as a fraction of total
// department FTE). ratio ~1.0 = proportional; >1.25 = doing more than their
// fair share; <0.75 = doing less (i.e. someone else is covering it).
// ------------------------------------------------------------------

export function computeFairnessRatio(actualCount, totalCount, fte, totalFte) {
  const actualShare = totalCount > 0 ? actualCount / totalCount : 0;
  const fteShare = totalFte > 0 ? (fte ?? DEFAULT_FTE) / totalFte : 0;
  return fteShare > 0 ? actualShare / fteShare : 0;
}

export function computeFairnessStatus(ratio) {
  if (ratio > 1.25) return 'over';
  if (ratio < 0.75) return 'under';
  return 'fair';
}

export const FAIRNESS_STYLES = {
  over: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', dot: 'bg-red-500', label: 'More than fair share' },
  under: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Less than fair share' },
  fair: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', dot: 'bg-green-500', label: 'Fair' },
};
