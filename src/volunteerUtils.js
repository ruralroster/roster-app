import { roleForGrade } from './staffGrade';

export const VOLUNTEER_ROLES = ['consultant', 'registrar'];

// Which roles on a card still need someone, and so can be offered for
// volunteering (see createVolunteerOffer):
//   - a location flagged "requires both a senior and a junior" needs each
//     role it hasn't got
//   - a graded card (an unnamed imported row) needs its grade's role
//   - any other card only needs someone once it's completely empty, and
//     then either role can fill it — the officer picks which to offer
// filledRoles is a Set of the roles already on the card.
export function missingRolesForCard({ requiresBoth, requiredGrade, filledRoles }) {
  const gradeRole = requiredGrade ? roleForGrade(requiredGrade) : null;
  return VOLUNTEER_ROLES.filter(role => {
    if (filledRoles.has(role)) return false;
    if (requiresBoth) return true;
    if (gradeRole) return gradeRole === role;
    return filledRoles.size === 0;
  });
}

// One Calendar day's colour, in priority order:
//   'none'      - nothing required and nothing rostered
//   'red'       - a required activity has nobody and hasn't been offered
//   'volunteer' - someone has volunteered for an open offer — an officer
//                 needs to accept them
//   'offered'   - every gap is offered for volunteering, nobody's
//                 picked one up yet
//   'orange'    - every required activity is covered, but on-call is short
//   'green'     - everything required is covered
export function classifyDayStatus({ requiredCount, unofferedGapCount, volunteerCount, openOfferCount, hasAnyOnCall, missingOnCallCount }) {
  if (requiredCount === 0 && !hasAnyOnCall && openOfferCount === 0) return 'none';
  if (unofferedGapCount > 0) return 'red';
  if (volunteerCount > 0) return 'volunteer';
  if (openOfferCount > 0) return 'offered';
  if (missingOnCallCount > 0) return 'orange';
  return 'green';
}
