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
//   - Everything else (ED and ward jobs, any job anyone can do) is shared
//     among everyone on what's left: FTE times the share of their shifts
//     not on skill-restricted work.
//   - What's skill-restricted is the place someone was booked into, not
//     just the job: an ED AST in a place that needs the ED skill is doing
//     specialist work (shared among the ED ASTs); in an ordinary ED place,
//     common work. exposureKey() gives such a place its own key.
//   - Weekends: everyone, by effective FTE. Nobody is exempt.
//   - On call, the same way: a type that needs a skill (anaesthetics on
//     call) among the people who can do it; a type everyone does (ED on
//     call overnight) on what's left of each person's share of all on call
//     after their specialist on call. Only people who've done it in the last
//     12 months or are willing count. A type only one person can do is
//     theirs, like a solo job. onCallScore is all on call together.
//   - A specialty anyone can cover (ED for an ED AST: any AST or consultant
//     can fill the ED spot) is set on the skill (specialtyActivities). Its
//     holders' shifts on those activities count as specialist time up to
//     the AST share: the share of shifts the least service-bound other
//     shared specialty's holders spend in it (anaesthetics, say, rather
//     than obstetrics, which the service needs every day). That time comes
//     out of their figures for common work like any specialist time; while
//     they're under it they're due those jobs first (score below 0). Past
//     it, their ED is ordinary ED, shared with everyone.
// Each score is what they've done ÷ their fair share: 1 = exactly fair,
// under 1 = behind (they should go first), over 1 = ahead.

import { DEFAULT_FTE } from './availabilityUtils';
import { addDays } from './plannerUtils';

const hasAny = (held, needed) => needed.some(id => held.includes(id));

// The key a booking counts under: the activity, or for a place that needs
// a skill, `${activityId}#${skill ids}` (that skilled work on its own).
export function exposureKey(activityId, place) {
  const skills = place?.required_advanced_skills || [];
  return skills.length ? `${activityId}#${[...skills].sort().join(',')}` : activityId;
}

// Skills a key needs: from the map, or a skilled place's own key.
const skillsForKey = (activitySkills, key) =>
  activitySkills.get(key) || (key.includes('#') ? key.split('#')[1].split(',') : []);
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
// specialtyActivities: skillId -> activity ids that are that skill's
//   specialty though anyone can do them (ED for the Emergency skill)
export function buildFairness({
  staff, totalShiftsByStaff, statsByStaffActivity, activitySkills = new Map(),
  weekendShiftsByStaff = new Map(), dutyTypes = [], dutyCounts = new Map(),
  specialtyActivities = new Map(),
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
    const needed = skillsForKey(activitySkills, activityId);
    const eligible = eligibleForSkills(needed);
    eligibleByActivity.set(activityId, eligible);
    if (needed.length && eligible.length === 1) soloOwner.set(activityId, eligible[0]);
  }
  const countOn = (staffId, activityId) => statsByStaffActivity.get(`${staffId}|${activityId}`)?.count || 0;
  const shiftsOf = (id) => totalShiftsByStaff.get(id) || 0;
  const restrictedKeys = [...activityIds].filter(a => skillsForKey(activitySkills, a).length > 0);

  // The AST share for open specialties: of each other skill shared by two
  // or more people, the share of its holders' shifts spent on work that
  // needs it; the lowest of those (the least service-bound specialty).
  const astShares = [];
  for (const skill of new Set(staff.flatMap(s => s.advanced_skills || []))) {
    if (specialtyActivities.get(skill)?.length) continue;
    const holders = ids.filter(id => skillsOf.get(id).includes(skill));
    const keys = restrictedKeys.filter(a => !soloOwner.has(a) && skillsForKey(activitySkills, a).includes(skill));
    if (holders.length < 2 || !keys.length) continue;
    const done = sumOf(holders.flatMap(id => keys.map(a => countOn(id, a))));
    const total = sumOf(holders.map(shiftsOf));
    if (done > 0 && total > 0) astShares.push({ skill, share: done / total });
  }
  const benchmark = astShares.reduce((low, s) => (!low || s.share < low.share ? s : low), null);
  const astShare = benchmark?.share || 0;

  // Each person's open-specialty activities, their shifts there, and how
  // many of those count as specialist time (skilled places there first).
  const homeActs = new Map(ids.map(id => [id, new Set((skillsOf.get(id) || [])
    .flatMap(skill => specialtyActivities.get(skill) || []))]));
  const homeDone = (id) => sumOf([...homeActs.get(id)].map(a => countOn(id, a)));
  const homeSkilled = (id) => sumOf(restrictedKeys.filter(k => homeActs.get(id).has(k.split('#')[0])).map(k => countOn(id, k)));
  const homeQuota = (id) => (homeActs.get(id).size ? astShare * shiftsOf(id) : 0);
  const homeSpecialist = new Map(ids.map(id => [id,
    Math.min(homeDone(id), Math.max(0, homeQuota(id) - homeSkilled(id)))]));
  // Shifts on an activity that count as common work.
  const commonOn = (id, activityId) => {
    const n = countOn(id, activityId);
    const done = homeDone(id);
    if (!n || !done || !homeActs.get(id).has(activityId)) return n;
    return n - homeSpecialist.get(id) * n / done;
  };
  const totalOn = (activityId) => sumOf(ids.map(id => commonOn(id, activityId)));

  // Effective FTE: solo work taken out (specialist and weekend shares);
  // all specialist work taken out (open jobs).
  const soloShifts = new Map(ids.map(id => [id, 0]));
  const restrictedShifts = new Map(ids.map(id => [id, homeSpecialist.get(id)]));
  for (const activityId of restrictedKeys) {
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

  // On call works like jobs: a type that needs a skill (anaesthetics on
  // call) is specialist, shared among those who can do it; a type anyone
  // does (ED on call overnight) is common, shared on what's left of each
  // person's fair share of all on call once their specialist on call is
  // taken off.
  const specialistType = (dt) => dt.required_advanced_skills?.length > 0 && !dutySolo.has(dt.key);
  const poolFte = sumOf(onCallPool.map(id => effFte.get(id)));
  const onCallLeft = new Map(ids.map(id => {
    if (!onCallPool.includes(id)) return [id, 0];
    const fairTotal = poolFte ? totalSharedOnCall * effFte.get(id) / poolFte : 0;
    const specialist = sumOf(dutyTypes.filter(specialistType).map(dt => dutyCount(id, dt.key)));
    return [id, Math.max(0, fairTotal - specialist)];
  }));

  return {
    soloOwner,
    effectiveFte: (id) => effFte.get(id),
    // The open-specialty benchmark: { skill, share } or null.
    astBenchmark: benchmark,
    // Someone's open-specialty time: { done, quota } in shifts, or null.
    astTime(id) {
      if (!homeActs.get(id)?.size || !astShare) return null;
      return { done: homeDone(id) + homeSkilled(id), quota: homeQuota(id) };
    },

    // Activity score for one person, or null if it's their solo job (or
    // they can't do it). Lower = more due.
    activityScore(id, activityId) {
      if (soloOwner.has(activityId)) return null;
      const restricted = skillsForKey(activitySkills, activityId).length > 0;
      const pool = eligibleByActivity.get(activityId) || ids;
      if (restricted) return ratio(countOn(id, activityId), totalOn(activityId), id, pool, effFte);
      // Their open specialty, under their AST share: due first, -1 (none
      // done yet) up to 0 (share reached).
      const quota = homeQuota(id);
      if (homeActs.get(id)?.has(activityId) && quota > 0) {
        const done = homeDone(id) + homeSkilled(id);
        if (done < quota) return done / quota - 1;
      }
      return ratio(commonOn(id, activityId), totalOn(activityId), id, pool, openFte);
    },

    weekendScore(id) {
      const total = sumOf(ids.map(p => weekendShiftsByStaff.get(p) || 0));
      return ratio(weekendShiftsByStaff.get(id) || 0, total, id, ids, effFte);
    },

    // This on-call type among the people who can do it; null if it's
    // theirs alone or they can't do it.
    dutyScore(id, key) {
      if (dutySolo.has(key)) return null;
      const dt = dutyTypes.find(d => d.key === key);
      const pool = dutyEligible.get(key) || [];
      const total = sumOf(pool.map(p => dutyCount(p, key)));
      return ratio(dutyCount(id, key), total, id, pool, dt && specialistType(dt) ? effFte : onCallLeft);
    },

    // All on call together, across the hospital (solo types left out).
    onCallScore(id) {
      return ratio(sharedOnCall(id), totalSharedOnCall, id, onCallPool, effFte);
    },
  };
}

// For ranking someone for one on-call type: that type's score, which for a
// common type already allows for all their on call across the hospital.
// null if they can't do it (or it's theirs alone).
export function dutyRankScore(fairness, id, key) {
  return fairness.dutyScore(id, key);
}

// "0.8× fair share" for pickers and reports.
export function formatFairShare(score) {
  if (score === null || score === undefined) return '';
  if (score < 0) return `AST time due (${Math.round((score + 1) * 100)}% of their share)`;
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
