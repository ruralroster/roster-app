// ============================================================
// STAFF GRADE — SMO / Registrar / Intern
// ============================================================
//
// The coarse level an unfilled card needs (theatre_activities.
// required_grade — see migrations/2026-10-13_theatre_activity_required_
// grade.sql) and the level a staff member's rank puts them at. Used to
// keep an advertised shift away from anyone below its level: an SMO shift
// is never offered to a registrar or intern, a registrar shift never to
// an intern. Anyone at or above the level can pick it up, matching the
// existing rule that a registrar offer is open to consultants too.

export const GRADE_LABEL = { smo: 'SMO', registrar: 'Registrar', intern: 'Intern' };

// A classic-format sheet section (parseRosterWeek's `section`) → the
// grade its rows are rostered at. null for anything else (e.g. the ED
// format, which has no sections).
export function gradeForSection(section) {
  if (section === 'consultant' || section === 'locum') return 'smo';
  if (section === 'rmo') return 'registrar';
  if (section === 'intern') return 'intern';
  return null;
}

// gradeForRank and gradeCanCover live in offerEligibility.js (shared with
// the notify-offer Edge Function); re-exported here so existing imports
// keep working.
export { gradeForRank, gradeCanCover } from './offerEligibility';

// The staff_assignments / volunteer_offers role a graded slot is filled
// under: SMO slots are consultant roles, everything junior is registrar.
export function roleForGrade(grade) {
  return grade === 'smo' ? 'consultant' : 'registrar';
}
