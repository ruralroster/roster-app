// Checks an already-uploaded Emergency Department roster against the
// department's own hard scheduling rules (confirmed 2026-09-01) —
// deliberately NOT the softer "aim for"/"try to" optimization goals
// (4-then-3 alternating night counts, working both weekend days, avoiding
// back-to-back weekends, locums avoiding nights) since those were
// explicitly called out as goals to skip for now, not rules to flag.
//
// Reconstructs each assignment's shift-code letter/time (the "0730B"
// shorthand edRosterExcelImport.js parses on the way in) from the stored
// location name + shift start_time, since that's not kept as its own
// column anywhere — same LETTER_LOCATION_MAP/SHIFT_TIME_MAP the importer
// uses, just inverted.
//
// This is deliberately ED-specific (tied to that department's own letter
// vocabulary and rank names), not a generic multi-department rules engine
// — confirmed 2026-09-01 that these rules only apply to the one
// department for now.

import { toLocalDateStr } from './dateUtils';

const LOCATION_TO_LETTER = {
  'Acute Team A': 'A',
  'Acute Team B': 'B',
  'Paediatrics': 'C',
  'Fast Track': 'D',
  'STTA': 'E',
  'A STAR': 'ST',
  'Teaching': 'T',
};

const START_TIME_TO_CODE = {
  '07:30': 'Day',
  '13:00': 'Evening',
  '22:00': 'Night',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NIGHT_SPACING_DAYS = 28;
const DAYS_OFF_AFTER_NIGHTS = 3;

function dateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dayOfWeek(dateStr) {
  return dateOnly(dateStr).getDay(); // 0 Sun .. 6 Sat
}

// A confirmed real fortnight boundary (2026-09-01) — every fortnight in
// this department's cycle is exactly 14 days from this date, forever in
// both directions. Weeks don't need an anchor like this: every Monday is
// already a real calendar-week boundary no matter which one you start
// counting from, since there's only one possible Monday grid. Fortnights
// have two possible phases against any arbitrary start date, so which one
// is "real" has to come from an actual confirmed date, not be inferred
// from whatever range happens to get queried — anchoring to the query's
// own start date (as this used to) silently produced different fortnight
// splits depending on what date range was checked, for the same roster.
const FORTNIGHT_ANCHOR = dateOnly('2026-06-08');

// The Monday-aligned 14-day fortnight (per FORTNIGHT_ANCHOR) that dateStr
// falls in.
function getFortnightStart(dateStr) {
  const diffDays = Math.floor((dateOnly(dateStr) - FORTNIGHT_ANCHOR) / MS_PER_DAY);
  const fortnightIndex = Math.floor(diffDays / 14);
  return addDays(FORTNIGHT_ANCHOR, fortnightIndex * 14);
}

// Reconstructs { date, letter, timeCode } from an assignment row shaped
// like staff_assignments joined with locations(name) and shifts(start_time)
// — returns null for anything that isn't a recognized ED location/time
// (e.g. a duty-type pick, or a department that isn't using this letter
// vocabulary at all), so callers can just filter those out.
export function reconstructShiftInfo(assignment) {
  const locationName = assignment.locations?.name;
  const startTime = assignment.shifts?.start_time?.slice(0, 5);
  const letter = LOCATION_TO_LETTER[locationName];
  const timeCode = START_TIME_TO_CODE[startTime];
  if (!letter || !timeCode) return null;
  return { date: assignment.date, letter, timeCode };
}

// Consecutive-calendar-day runs of Night-coded shifts, sorted chronologically.
function findNightBlocks(shiftsByDate) {
  const nightDates = Object.keys(shiftsByDate)
    .filter(d => shiftsByDate[d].some(s => s.timeCode === 'Night'))
    .sort();

  const blocks = [];
  let current = null;
  for (const dateStr of nightDates) {
    if (current && toLocalDateStr(addDays(dateOnly(current.end), 1)) === dateStr) {
      current.end = dateStr;
      current.dates.push(dateStr);
    } else {
      current = { start: dateStr, end: dateStr, dates: [dateStr] };
      blocks.push(current);
    }
  }
  return blocks;
}

const MON_THU = new Set([1, 2, 3, 4]);
const FRI_SUN = new Set([5, 6, 0]);

// Runs every rule against one person's shifts (already filtered to just
// this staff member, spanning the whole checked range) and returns a flat
// list of { rule, message, dates } violations for them.
function checkPersonViolations(shiftsByDate, rank) {
  const violations = [];
  const isLocum = rank === 'Locums';
  const isTS4 = rank === 'TS4';

  // --- Night blocks: shape (Mon-Thu or Fri-Sun only), days off after,
  // and spacing between separate blocks.
  const nightBlocks = findNightBlocks(shiftsByDate);
  nightBlocks.forEach((block, i) => {
    const days = block.dates.map(dayOfWeek);
    const spansMonThu = days.every(d => MON_THU.has(d));
    const spansFriSun = days.every(d => FRI_SUN.has(d));
    if (!spansMonThu && !spansFriSun) {
      violations.push({
        key: `night-shape:${block.start}`,
        rule: 'Night shape',
        message: `Night block ${block.start} to ${block.end} isn't confined to Mon-Thu or Fri-Sun`,
        dates: block.dates,
      });
    }

    const daysOffNeeded = Array.from({ length: DAYS_OFF_AFTER_NIGHTS }, (_, n) => toLocalDateStr(addDays(dateOnly(block.end), n + 1)));
    const workedDuringRest = daysOffNeeded.filter(d => shiftsByDate[d]);
    if (workedDuringRest.length > 0) {
      violations.push({
        key: `rest-after-nights:${block.end}`,
        rule: 'Rest after nights',
        message: `Rostered on ${workedDuringRest.join(', ')} — fewer than 3 full days off after the night block ending ${block.end}`,
        dates: workedDuringRest,
      });
    }

    if (i > 0) {
      const prevStart = dateOnly(nightBlocks[i - 1].start);
      const gapDays = Math.round((dateOnly(block.start) - prevStart) / MS_PER_DAY);
      if (gapDays < NIGHT_SPACING_DAYS) {
        violations.push({
          key: `night-spacing:${block.start}`,
          rule: 'Night spacing',
          message: `Two separate night blocks within ${NIGHT_SPACING_DAYS} days: starting ${nightBlocks[i - 1].start} and ${block.start}`,
          dates: [...nightBlocks[i - 1].dates, ...block.dates],
        });
      }
    }
  });

  // --- Weekly caps (Monday-anchored calendar weeks — any Monday works
  // here, since there's only one possible Monday grid, unlike fortnights
  // below): at most one non-night D shift, at most one non-night E shift.
  // Each confirmed independently as its own fact, not derived from a
  // "weekly caps always exclude nights" rule — confirmed 2026-09-01 not
  // to assume that pattern extends to any rule added later; whether a
  // night counts is a per-rule detail to confirm each time, not something
  // to infer from whether the window is a week or a fortnight.
  const allDates = Object.keys(shiftsByDate).sort();
  if (allDates.length > 0) {
    const firstMonday = addDays(dateOnly(allDates[0]), -((dayOfWeek(allDates[0]) + 6) % 7));
    const lastDate = dateOnly(allDates[allDates.length - 1]);
    for (let weekStart = firstMonday; weekStart <= lastDate; weekStart = addDays(weekStart, 7)) {
      const weekDates = Array.from({ length: 7 }, (_, n) => toLocalDateStr(addDays(weekStart, n)));
      const weekShifts = weekDates.flatMap(d => shiftsByDate[d] || []);

      const dShifts = weekShifts.filter(s => s.letter === 'D' && s.timeCode !== 'Night');
      if (dShifts.length > 1) {
        violations.push({
          key: `d-cap:${weekDates[0]}`,
          rule: 'D shift weekly cap',
          message: `${dShifts.length} non-night D shifts in the week of ${weekDates[0]} (max 1)`,
          dates: weekDates.filter(d => (shiftsByDate[d] || []).some(s => s.letter === 'D' && s.timeCode !== 'Night')),
        });
      }

      const eShifts = weekShifts.filter(s => s.letter === 'E' && s.timeCode !== 'Night');
      if (eShifts.length > 1) {
        violations.push({
          key: `e-cap:${weekDates[0]}`,
          rule: 'E shift weekly cap',
          message: `${eShifts.length} non-night E shifts in the week of ${weekDates[0]} (max 1)`,
          dates: weekDates.filter(d => (shiftsByDate[d] || []).some(s => s.letter === 'E' && s.timeCode !== 'Night')),
        });
      }
    }

    // --- Fortnightly minimums, anchored to FORTNIGHT_ANCHOR (a confirmed
    // real fortnight boundary) rather than to whatever date range happens
    // to be queried: at least one C shift (nights count), at least one ST
    // shift for TS4, and a locum's total shift count capped at 10.
    const fortnightStarts = [...new Set(allDates.map(d => toLocalDateStr(getFortnightStart(d))))].sort();
    for (const fnStartStr of fortnightStarts) {
      const fnStart = dateOnly(fnStartStr);
      const fnDates = Array.from({ length: 14 }, (_, n) => toLocalDateStr(addDays(fnStart, n)));
      const fnShifts = fnDates.flatMap(d => shiftsByDate[d] || []);
      const fnLabel = `fortnight of ${fnDates[0]}`;

      const cShifts = fnShifts.filter(s => s.letter === 'C');
      if (cShifts.length === 0) {
        violations.push({
          key: `c-min:${fnDates[0]}`,
          rule: 'C shift fortnightly minimum',
          message: `No C shifts in the ${fnLabel} (need at least 1)`,
          dates: [fnDates[0]],
        });
      }

      if (isTS4) {
        const stShifts = fnShifts.filter(s => s.letter === 'ST');
        if (stShifts.length === 0) {
          violations.push({
            key: `st-min:${fnDates[0]}`,
            rule: 'ST fortnightly minimum (TS4)',
            message: `No ST shifts in the ${fnLabel} (need at least 1 for TS4)`,
            dates: [fnDates[0]],
          });
        }
      }

      if (isLocum && fnShifts.length > 10) {
        violations.push({
          key: `locum-cap:${fnDates[0]}`,
          rule: 'Locum fortnightly cap',
          message: `${fnShifts.length} shifts in the ${fnLabel} (locums capped at 10)`,
          dates: fnDates.filter(d => shiftsByDate[d]),
        });
      }
    }
  }

  return violations;
}

// assignments: flat array of staff_assignments rows joined with
// locations(name), shifts(start_time), and staff_id — same shape
// getAllStaffAssignmentsForRange already returns. staffById: Map of
// staff_id -> { name, rank }. Returns a Map of staff_id -> violations[],
// omitting anyone with none.
export function checkEdRuleViolations(assignments, staffById) {
  const shiftsByStaffAndDate = new Map(); // staff_id -> { date -> [{letter,timeCode}] }

  for (const assignment of assignments) {
    const info = reconstructShiftInfo(assignment);
    if (!info) continue;

    if (!shiftsByStaffAndDate.has(assignment.staff_id)) shiftsByStaffAndDate.set(assignment.staff_id, {});
    const byDate = shiftsByStaffAndDate.get(assignment.staff_id);
    if (!byDate[info.date]) byDate[info.date] = [];
    byDate[info.date].push(info);
  }

  const violationsByStaff = new Map();
  for (const [staffId, byDate] of shiftsByStaffAndDate.entries()) {
    const rank = staffById.get(staffId)?.rank;
    const violations = checkPersonViolations(byDate, rank);
    if (violations.length > 0) violationsByStaff.set(staffId, violations);
  }

  return violationsByStaff;
}

// Day-level (not per-person) minimum headcounts, confirmed 2026-09-01:
// Early = 0730, Late = 1300. Thursday's Early shift has its own split
// (>=4 clinical, >=2 teaching) INSTEAD of the plain 6-total check — the
// two minimums already add up to the same 6, with Teaching (which isn't
// in the general Early letter set at all) now eligible to fill part of
// it, so checking both the split AND the plain total would just be the
// same requirement twice.
const EARLY_LATE_LETTERS = new Set(['ST', 'A', 'B', 'C', 'D', 'E']);
const NIGHT_LETTERS = new Set(['A', 'B', 'C', 'E']);
const THURSDAY_CLINICAL_LETTERS = new Set(['A', 'B', 'D', 'E']);

const MIN_EARLY = 6;
const MIN_LATE = 6;
const MIN_NIGHT = 4;
const MIN_THURSDAY_CLINICAL = 4;
const MIN_THURSDAY_TEACHING = 2;

// assignments: same shape as checkEdRuleViolations expects. Returns a
// flat, date-sorted array of { date, rule, message } — these aren't
// anyone's individual fault, so they're not attached to a staff_id.
export function checkEdStaffingLevels(assignments) {
  const byDateAndTime = new Map(); // `${date}|${timeCode}` -> letter[]

  for (const assignment of assignments) {
    const info = reconstructShiftInfo(assignment);
    if (!info) continue;
    const key = `${info.date}|${info.timeCode}`;
    if (!byDateAndTime.has(key)) byDateAndTime.set(key, []);
    byDateAndTime.get(key).push(info.letter);
  }

  const violations = [];
  const dates = [...new Set(assignments.map(a => a.date))].sort();

  for (const date of dates) {
    const earlyLetters = byDateAndTime.get(`${date}|Day`) || [];
    if (dayOfWeek(date) === 4) {
      const clinicalCount = earlyLetters.filter(l => THURSDAY_CLINICAL_LETTERS.has(l)).length;
      const teachingCount = earlyLetters.filter(l => l === 'T').length;
      if (clinicalCount < MIN_THURSDAY_CLINICAL) {
        violations.push({ key: `thu-clinical-min:${date}`, date, rule: 'Thursday Early — clinical minimum', message: `Only ${clinicalCount} on clinical shifts (A/B/D/E) — need at least ${MIN_THURSDAY_CLINICAL}` });
      }
      if (teachingCount < MIN_THURSDAY_TEACHING) {
        violations.push({ key: `thu-teaching-min:${date}`, date, rule: 'Thursday Early — teaching minimum', message: `Only ${teachingCount} on teaching (0730T) — need at least ${MIN_THURSDAY_TEACHING}` });
      }
    } else {
      const earlyCount = earlyLetters.filter(l => EARLY_LATE_LETTERS.has(l)).length;
      if (earlyCount < MIN_EARLY) {
        violations.push({ key: `early-min:${date}`, date, rule: 'Early shift minimum', message: `Only ${earlyCount} reg on Early — need at least ${MIN_EARLY}` });
      }
    }

    const lateLetters = byDateAndTime.get(`${date}|Evening`) || [];
    const lateCount = lateLetters.filter(l => EARLY_LATE_LETTERS.has(l)).length;
    if (lateCount < MIN_LATE) {
      violations.push({ key: `late-min:${date}`, date, rule: 'Late shift minimum', message: `Only ${lateCount} reg on Late — need at least ${MIN_LATE}` });
    }

    const nightLetters = byDateAndTime.get(`${date}|Night`) || [];
    const nightCount = nightLetters.filter(l => NIGHT_LETTERS.has(l)).length;
    if (nightCount < MIN_NIGHT) {
      violations.push({ key: `night-min:${date}`, date, rule: 'Night shift minimum', message: `Only ${nightCount} reg on Night — need at least ${MIN_NIGHT}` });
    }
  }

  return violations;
}
