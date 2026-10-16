import { jobCategoryFor } from './jobColours';
import { dutyTypeForOnCallKind } from './rosterExcelImport';

// ============================================================
// ED LATE = ED ON CALL (when nobody else is)
// ============================================================
//
// Department rule (confirmed 2026-10-16): on a day with nobody in the ED
// on-call slot, the consultant on the ED late shift is ED on call. The
// sheet's "EDL + OC" code says the same thing, but a day can also be
// allocated by hand with the slot left empty.
//
// Display only — nothing is written to duty_assignments, so callbacks,
// the fairness report and fatigue checks still read the real slot, and
// filling the slot (by hand or by import) takes over straight away.

const minutes = (time) => {
  const [h, m] = (time || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

// A consultant on an Emergency shift starting 10:00-14:00 and finishing
// 20:00 or later — the EDL (10:30-21:00). Registrars' "Evening 1300-2300"
// and interns' "ED 1030-2030" aren't consultant shifts, so never count.
export function isEdLateAssignment(assignment) {
  if (assignment.role !== 'consultant') return false;
  if (jobCategoryFor(assignment.locations?.name) !== 'emergency') return false;
  const start = minutes(assignment.shifts?.start_time);
  const end = minutes(assignment.shifts?.end_time);
  if (start === null || end === null) return false;
  return start >= 10 * 60 && start <= 14 * 60 && end >= 20 * 60;
}

// One day's stand-in ED on-call: { dutyKey, dutyLabel, staffId, staffName }
// when the department's ED on-call slot is empty and exactly one
// consultant is on the ED late; null otherwise (slot filled, no ED late,
// or more than one — never a guess between two people).
// dayAssignments: staff_assignments rows for the day (with locations and
// shifts joined); dayDutyKeys: the duty_type keys filled that day.
export function edLateOnCallFor(dayAssignments, dayDutyKeys, dutyTypes) {
  const edDuty = dutyTypeForOnCallKind('ed', dutyTypes);
  if (!edDuty || dayDutyKeys.includes(edDuty.key)) return null;
  const edLate = dayAssignments.filter(isEdLateAssignment);
  const staffIds = new Set(edLate.map(a => a.staff_id));
  if (staffIds.size !== 1) return null;
  return { dutyKey: edDuty.key, dutyLabel: edDuty.label, staffId: edLate[0].staff_id, staffName: edLate[0].staff?.name };
}
