import { isEdLateAssignment } from './coffeeDay';
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

// isEdLateAssignment lives in coffeeDay.js (the coffee emails need it too).
export { isEdLateAssignment };

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
