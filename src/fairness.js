// Fair shares for allocation: jobs (activities), weekends and on call.
// Used by the Planner's job numbers, the Day view's pickers and the
// On-Call & Weekend Fairness report, so they all agree. Pure, so it can
// be unit tested.
//
// The rules (agreed with the department):
//   - A job only one person can do (they're the only active holder of the
//     skill it needs) is theirs: it isn't ranked, and those shifts come
//     out of their figures, so they don't fall behind on everything else.
//     Their effective FTE is their FTE times the share of their shifts
//     left over (20% of shifts on solo endoscopy lists → 0.8 of their FTE).
//   - A job several people can do (it needs a skill more than one person
//     holds, e.g. anaesthetics) is shared among those people by effective
//     FTE.
//   - Everything else (ward jobs) is shared among everyone on what's left:
//     FTE times the share of their shifts not on skill-restricted jobs.
//   - Weekends: everyone, by effective FTE. Nobody is exempt.
//   - On call: each on-call type among the people who can do it (hold its
//     skill, and have done it in the last 12 months or are willing), by
//     effective FTE; and all on call together across the hospital, among
//     everyone who does any. A type only one person can do is theirs, like
//     a solo job.
// Each score is what they've done ÷ their fair share: 1 = exactly fair,
// under 1 = behind (they should go first), over 1 = ahead.

import { DEFAULT_FTE } from './availabilityUtils';
import { addDays } from './plannerUtils';

const hasAny = (held, needed) => needed.some(id => held.includes(id));
const sumOf = (values) => values.reduce((a, b) => a + b, 0);

// activityId -> skill ids its staff places need. An activity's own
// required skills; otherwise, if every staff place on every job for that
// activity needs a skill, any of those skills. Empty = open to anyone.
export function activitySkillMap(activities, jobTypes = [], places = []) {
  const map = new Map();
  for (const a of activities) {
    if (a.required_advanced_skills?.length) {
      map.set(a.activity_id, a.required_advanced_skills);
      continue;
    }
    const jobIds = new Set(jobTypes.filter(j => j.activity_id === a.activity_id).map(j => j.job_type_id));
    const staffPlaces = places.filter(p => jobIds.has(p.job_type_id) && p.kind !== 'visitor');
    if (staffPlaces.length && staffPlaces.every(p => p.required_advanced_skills?.length)) {
      map.set(a.activity_id, [...new Set(staffPlaces.flatMap(p => p.required_advanced_skills))]);
    } else {
      map.set(a.activity_id, []);
    }
  }
  return map;
}

// staff: active staff [{ staff_id, fte, advanced_skills, on_call_willing }]
// totalShiftsByStaff: staffId -> shifts in the last 12 months
// statsByStaffActivity: `${staffId}|${activityId}` -> { count, lastDate }
// activitySkills: activitySkillMap(...)
// weekendShiftsByStaff: staffId -> weekend shifts
// dutyTypes: on-call duty types [{ key, required_advanced_skills }]
// dutyCounts: `${staffId}|${dutyKey}` -> on-call shifts of that type
export function buildFairness({
  staff, totalShiftsByStaff, statsByStaffActivity, activitySkills = new Map(),
  weekendShiftsByStaff = new Map(), dutyTypes = [], dutyCounts = new Map(),
}) {
  const ids = staff.map(s => s.staff_id);
  const skillsOf = new Map(staff.map(s => [s.staff_id, s.advanced_skills || []]));
  const fteOf = new Map(staff.map(s => [s.staff_id, s.fte ?? DEFAULT_FTE]));
  const eligibleForSkills = (needed) => (needed?.length ? ids.filter(id => hasAny(skillsOf.get(id), needed)) : ids);

  // Activities: who can do each, and whose alone it is.
  const activityIds = new Set([...activitySkills.keys()]);
  for (const key of statsByStaffActivity.keys()) activityIds.add(key.split('|')[1]);
  const eligibleByActivity = new Map();
  const soloOwner = new Map(); // activityId -> staffId
  for (const activityId of activityIds) {
    const needed = activitySkills.get(activityId) || [];
    const eligible = eligibleForSkills(needed);
    eligibleByActivity.set(activityId, eligible);
    if (needed.length && eligible.length === 1) soloOwner.set(activityId, eligible[0]);
  }
  const countOn = (staffId, activityId) => statsByStaffActivity.get(`${staffId}|${activityId}`)?.count || 0;
  const totalOn = (activityId) => sumOf(ids.map(id => countOn(id, activityId)));

  // Effective FTE: solo work taken out (specialist and weekend shares);
  // all skill-restricted work taken out (open jobs).
  const soloShifts = new Map(ids.map(id => [id, 0]));
  const restrictedShifts = new Map(ids.map(id => [id, 0]));
  for (const activityId of activityIds) {
    const restricted = (activitySkills.get(activityId) || []).length > 0;
    if (!restricted) continue;
    for (const id of ids) {
      const n = countOn(id, activityId);
      if (!n) continue;
      if (soloOwner.get(activityId) === id) soloShifts.set(id, soloShifts.get(id) + n);
      else restrictedShifts.set(id, restrictedShifts.get(id) + n);
    }
  }
  const leftOver = (id, taken) => {
    const total = totalShiftsByStaff.get(id) || 0;
    return total ? Math.max(0, 1 - taken / total) : 1;
  };
  const effFte = new Map(ids.map(id => [id, fteOf.get(id) * leftOver(id, soloShifts.get(id))]));
  const openFte = new Map(ids.map(id => [id, fteOf.get(id) * leftOver(id, soloShifts.get(id) + restrictedShifts.get(id))]));

  // done ÷ fair share of `total` among `pool`, weighted by `weights`.
  const ratio = (done, total, id, pool, weights) => {
    if (!pool.includes(id)) return null;
    const poolWeight = sumOf(pool.map(p => weights.get(p)));
    const expected = poolWeight ? total * weights.get(id) / poolWeight : 0;
    if (expected > 0) return done / expected;
    return done > 0 ? 99 : 0;
  };

  // On call: who can do each type, whose alone it is, and the hospital pool.
  const dutyEligible = new Map();
  const dutySolo = new Map();
  for (const dt of dutyTypes) {
    const pool = eligibleForSkills(dt.required_advanced_skills)
      .filter(id => dutyCounts.get(`${id}|${dt.key}`) > 0 || staff.find(s => s.staff_id === id)?.on_call_willing !== false);
    dutyEligible.set(dt.key, pool);
    if (dt.required_advanced_skills?.length && pool.length === 1) dutySolo.set(dt.key, pool[0]);
  }
  const dutyCount = (id, key) => dutyCounts.get(`${id}|${key}`) || 0;
  const sharedOnCall = (id) => sumOf(dutyTypes.filter(dt => dutySolo.get(dt.key) !== id).map(dt => dutyCount(id, dt.key)));
  const onCallPool = ids.filter(id => dutyTypes.some(dt => dutyEligible.get(dt.key).includes(id)));
  const totalSharedOnCall = sumOf(onCallPool.map(sharedOnCall));

  return {
    soloOwner,
    effectiveFte: (id) => effFte.get(id),

    // Activity score for one person, or null if it's their solo job (or
    // they can't do it). Lower = more due.
    activityScore(id, activityId) {
      if (soloOwner.has(activityId)) return null;
      const restricted = (activitySkills.get(activityId) || []).length > 0;
      const pool = eligibleByActivity.get(activityId) || ids;
      return ratio(countOn(id, activityId), totalOn(activityId), id, pool, restricted ? effFte : openFte);
    },

    weekendScore(id) {
      const total = sumOf(ids.map(p => weekendShiftsByStaff.get(p) || 0));
      return ratio(weekendShiftsByStaff.get(id) || 0, total, id, ids, effFte);
    },

    // This on-call type among the people who can do it; null if it's
    // theirs alone or they can't do it.
    dutyScore(id, key) {
      if (dutySolo.has(key)) return null;
      const pool = dutyEligible.get(key) || [];
      const total = sumOf(pool.map(p => dutyCount(p, key)));
      return ratio(dutyCount(id, key), total, id, pool, effFte);
    },

    // All on call together, across the hospital (solo types left out).
    onCallScore(id) {
      return ratio(sharedOnCall(id), totalSharedOnCall, id, onCallPool, effFte);
    },
  };
}

// For ranking someone for one on-call type: half how they stand on that
// type, half on all on call. null if they can't do it (or it's theirs alone).
export function dutyRankScore(fairness, id, key) {
  const own = fairness.dutyScore(id, key);
  if (own === null) return null;
  const overall = fairness.onCallScore(id);
  return overall === null ? own : (own + overall) / 2;
}

// "0.8× fair share" for pickers and reports.
export function formatFairShare(score) {
  if (score === null || score === undefined) return '';
  if (score >= 99) return 'no fair share yet';
  return `${score.toFixed(2)}× fair share`;
}

// On call goes with a shift: true if staffId is on one of the duty type's
// lead-in shifts on dateStr, or one of its follow-on shifts the next day.
// They're offered that on call first. bookings: staff_assignments rows
// ({ staff_id, date, shift_id }) for dateStr and the day after.
export function goesWithOnCall(dutyType, staffId, dateStr, bookings) {
  const leadIn = dutyType?.lead_in_shift_ids || [];
  const followOn = dutyType?.follow_on_shift_ids || [];
  if (!leadIn.length && !followOn.length) return false;
  const next = addDays(dateStr, 1);
  return bookings.some(b => b.staff_id === staffId && (
    (b.date === dateStr && leadIn.includes(b.shift_id)) || (b.date === next && followOn.includes(b.shift_id))));
}
