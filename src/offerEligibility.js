// ============================================================
// OFFER ELIGIBILITY — who can pick up a shift offered for volunteering
// ============================================================
//
// One copy of these rules for both places that need them: the staff
// Available Shifts list (getAvailableShiftsForStaff) and the notify-offer
// Edge Function, which emails/pushes the same people when an officer
// offers a shift. The Edge Function can't import from src/, so
// supabase/functions/_shared/offerEligibility.js is a byte-for-byte copy
// of this file — offerEligibility.test.js fails if they drift. Edit this
// one, then copy it across.
//
// Plain JavaScript with no imports, so it runs unchanged in the browser,
// in Jest and in Deno.

const GRADE_ORDER = { intern: 0, registrar: 1, smo: 2 };

// rankRow: the staff member's rank_supervision_rules row. Same split as
// the import tab's rank suggestion: no supervision needed → SMO, a rank
// named like "intern" → Intern, every other supervised rank → Registrar.
// null when the rank isn't configured.
export function gradeForRank(rankRow) {
  if (!rankRow) return null;
  if (rankRow.requires_supervision === false) return 'smo';
  if (/intern/i.test(rankRow.rank || '')) return 'intern';
  return 'registrar';
}

// No required grade → no restriction. A required grade but no known
// staff grade → not eligible (the safe default).
export function gradeCanCover(staffGrade, requiredGrade) {
  if (!requiredGrade) return true;
  if (!staffGrade) return false;
  return GRADE_ORDER[staffGrade] >= GRADE_ORDER[requiredGrade];
}

// Senior shifts (consultant offers, SMO-graded cards) are open to senior
// ranks and to ranks ticked "Can cover senior shifts" (advanced trainees
// — rank_supervision_rules.can_cover_senior). An advanced trainee still
// requires supervision for normal rostering; this only widens which
// offers they're eligible for.
export function canCoverSenior(rankRow) {
  if (!rankRow) return false;
  return rankRow.requires_supervision === false || rankRow.can_cover_senior === true;
}

// The grade a rank counts as when checking an offer's required grade.
export function offerGradeForRank(rankRow) {
  return canCoverSenior(rankRow) ? 'smo' : gradeForRank(rankRow);
}

// Every rule a staff member must pass to be offered (and notified about)
// one volunteer_offers row:
//   offerRole      - the offer's role, 'consultant' or 'registrar'
//   rankRow        - the staff member's rank row (null if not configured)
//   requiredGrade  - theatre_activities.required_grade, or null
//   roleFilled     - someone already holds the offer's role on the card
//   isAvailable    - they've marked themselves available that date
//                    (an unset day doesn't count)
//   activityName   - the card's activity name, or null
//   restrictions   - the staff member's activity_restrictions
//   requiredSkills - the activity's required_advanced_skills (any one)
//   skills         - the staff member's advanced_skills
// A consultant offer needs someone who can cover senior shifts; a
// registrar offer is open to every configured rank. Specialty limits
// (obstetricians off anaesthetic shifts and so on) come from
// requiredSkills — ED has none, so anyone can take it.
export function isEligibleForOffer({
  offerRole,
  rankRow,
  requiredGrade,
  roleFilled,
  isAvailable,
  activityName,
  restrictions = [],
  requiredSkills = [],
  skills = [],
}) {
  if (!rankRow) return false;
  if (offerRole === 'consultant' && !canCoverSenior(rankRow)) return false;
  if (!gradeCanCover(offerGradeForRank(rankRow), requiredGrade)) return false;
  if (roleFilled) return false;
  if (!isAvailable) return false;
  if (activityName && restrictions.includes(activityName)) return false;
  if (requiredSkills.length > 0 && !requiredSkills.some(id => skills.includes(id))) return false;
  return true;
}
