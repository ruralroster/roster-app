// The Planner's Suggest: fills the empty places shown with the fairest
// person who can take each one, as drafts the officer checks before
// booking. Pure, so it can be unit tested.
//
// Each suggestion passes the same checks as booking by hand (grade and
// skills, leave and availability, clashes and 10 hours' rest, the FTE cap)
// plus the Shift Pattern Rules, which a suggestion must never break (WARN
// rules too), and it doesn't take anyone past their FTE hours.
//
// 1. Fill: the place with the fewest people who could take it goes first,
//    so someone who's the only one for a specialist list isn't used up on
//    general work. It goes to the top of rankPeopleForPlace (fairness over
//    12 months, weekends, whoever did the job yesterday), and that booking
//    counts towards the next pick.
//    FTE comes first, though: if someone can only reach their FTE's hours
//    for the pay fortnight by taking this place (the places left that they
//    could take don't add up to it otherwise), they get it, the furthest
//    behind (as a share of their FTE) first. Only in a pay
//    fortnight wholly in view.
// 2. Keep days together: someone working Mon, Tue, Fri is better on Mon,
//    Tue, Wed. Two suggestions swap people when both still pass every
//    check, nobody ends up further short of their FTE, and it leaves fewer
//    separate stretches of work between them.
// 3. Anyone still short of their FTE for a pay fortnight the places are in
//    is listed, so the officer can see it before booking.

import { addDays, dayConflict, placeMismatch, rankPeopleForPlace, withBookings } from './plannerUtils';
import { buildFairness, exposureKey, isCasual } from './fairness';
import { fortnightLoad, hoursBooked, leaveDayHours, payFortnightRange, shiftHours } from './fteFortnight';
import { hasLeft } from './availabilityUtils';

const MAX_SWAPS = 50;

// The Shift Pattern Rule (shift_pattern_rules: shift_1_id is 6 days before
// through shift_7_id the day itself, null = any shift) that decides
// dateStr for someone whose shift each day is shiftByDate, as
// validateShiftAssignment does: the most specific match. A day with no
// shift reads as Day Off (offShiftId).
function decidingRule(rules, offShiftId, shiftByDate, dateStr) {
  if (!shiftByDate.has(dateStr)) return null;
  const sequence = [6, 5, 4, 3, 2, 1, 0].map(n => {
    const d = addDays(dateStr, -n);
    return shiftByDate.has(d) ? shiftByDate.get(d) : offShiftId;
  });
  let best = null;
  let bestSpecificity = -1;
  for (const rule of rules) {
    const cols = [rule.shift_1_id, rule.shift_2_id, rule.shift_3_id, rule.shift_4_id, rule.shift_5_id, rule.shift_6_id, rule.shift_7_id];
    if (!cols.every((col, i) => col === null || col === undefined || col === sequence[i])) continue;
    const specificity = cols.filter(c => c !== null && c !== undefined).length;
    if (specificity > bestSpecificity) {
      best = rule;
      bestSpecificity = specificity;
    }
  }
  return best;
}

// Why adding shiftId on dateStr to someone's days (shiftByDate) breaks a
// Shift Pattern Rule, or null. Checks that day and the six after it: a
// new shift changes what comes before each of them. actions: which
// rule_actions count (['BLOCK'] by hand, ['BLOCK', 'WARN'] for Suggest).
export function patternProblem(rules, offShiftId, shiftByDate, dateStr, shiftId, actions = ['BLOCK', 'WARN']) {
  if (!rules?.length) return null;
  const after = new Map(shiftByDate);
  after.set(dateStr, shiftId);
  for (let i = 0; i <= 6; i++) {
    const d = addDays(dateStr, i);
    const now = decidingRule(rules, offShiftId, after, d);
    if (!now || !actions.includes(now.rule_action)) continue;
    // A later day that already broke the rule isn't this shift's doing.
    if (i > 0) {
      const before = decidingRule(rules, offShiftId, shiftByDate, d);
      if (before && actions.includes(before.rule_action)) continue;
    }
    return `Shift pattern rule: ${now.description || now.rule_action}`;
  }
  return null;
}

// Each person's shift on each day, from staff_assignments rows: every row
// with a shift except on call, which isn't a shift worked, as
// validateShiftAssignment reads them (the last row on a day wins).
export function shiftsByPerson(bookings) {
  const out = new Map();
  for (const b of bookings) {
    if (!b.shift_id || b.on_call) continue;
    if (!out.has(b.staff_id)) out.set(b.staff_id, new Map());
    out.get(b.staff_id).set(b.date, b.shift_id);
  }
  return out;
}

// Separate stretches of work in dates (sorted 'YYYY-MM-DD' strings).
export function stretches(dates) {
  const sorted = [...new Set(dates)].sort();
  let n = 0;
  sorted.forEach((d, i) => { if (i === 0 || addDays(sorted[i - 1], 1) !== d) n += 1; });
  return n;
}

// slots: the empty places to fill, [{ key, card, job, place }].
// ctx: {
//   staff (active staff rows), rankRows, todayStr,
//   assignments (the view's staff_assignments, with shifts(start_time,
//     end_time) and theatre_activity_id; a day either side included),
//   unavailable ([{ staff_id, date }]),
//   bookings (staff_assignments rows from 6 days before the first slot's
//     pay fortnight to 6 days after the last: { staff_id, date, shift_id,
//     on_call, leave_code, shifts }), for FTE, leave and pattern rules,
//   rules, offShiftId, exposure (getExposureStats),
//   otherSite (this department's staff working at other Rstar sites, as
//     booking rows: clashes and rest only, never fairness or FTE),
//   viewFrom, viewTo (the days shown; FTE comes first only in a pay
//     fortnight wholly inside them),
//   isAdminCard(card), sameJob(cardA, cardB), cardLabel(assignment),
//   cardOf(assignment) (its card, if in view), activityKeyOf(assignment)
//   (exposureKey of its card and place), isClashFree(assignment) (Admin),
// }
// Returns { drafts: [{ key, staffId, name, reason, moved }], unfilled: [key],
//   shortfalls: [{ staffId, name, from, to, hours, target }] } (people with an
//   FTE short of it in a pay fortnight the slots are in, with the drafts).
export function suggestFill(slots, ctx) {
  const { staff, rankRows, todayStr, unavailable, rules, offShiftId, exposure, isAdminCard, sameJob, cardLabel } = ctx;
  const staffById = new Map(staff.map(s => [s.staff_id, s]));
  const slotByKey = new Map(slots.map(s => [s.key, s]));
  // A leave day counts as the average shift for their rank.
  const leaveHours = ctx.leaveHours || leaveDayHours(staff, ctx.bookings);
  const loadOf = (s, dateStr, bookings) => fortnightLoad(s, dateStr, bookings, leaveHours);

  const existing = ctx.assignments.map(a => ({
    ...a, card: ctx.cardOf(a), activityKey: ctx.activityKeyOf(a), isAdmin: ctx.isClashFree(a),
  }));

  // What's booked, plus a list of suggestions.
  let drafts = [];
  const draftRow = (d) => {
    const { card, place } = slotByKey.get(d.key);
    return {
      staff_id: d.staffId, date: card.date, shift_id: card.shift_id, on_call: false, leave_code: null,
      theatre_activity_id: card.theatre_activity_id, place_id: place.place_id,
      shifts: { start_time: card.start_time, end_time: card.end_time },
      card, activityKey: exposureKey(card.activity_id, place), isAdmin: isAdminCard(card),
    };
  };
  const state = (list = drafts) => {
    const rows = list.map(draftRow);
    return { assignments: [...existing, ...rows], bookings: [...ctx.bookings, ...rows] };
  };

  const slotHours = (slot) => shiftHours(slot.card.date, slot.card.start_time, slot.card.end_time);
  const fortnights = [...new Map(slots.map(sl => {
    const r = payFortnightRange(sl.card.date);
    return [r.from, r];
  })).values()];

  const onLeave = (staffId, dateStr, bookings) => bookings.some(b => b.staff_id === staffId && b.date === dateStr && b.leave_code);

  // Why staffId can't take slot as things stand, or null.
  const problem = (staffId, slot, st) => {
    const s = staffById.get(staffId);
    const { card, place } = slot;
    if (!s) return 'Not active';
    if (hasLeft(s, card.date)) return 'Left';
    // Seniors stay out of junior places unless the officer allows it.
    const mismatch = placeMismatch(place, s, rankRows, { seniorsInJunior: !!ctx.seniorsInJunior });
    if (mismatch) return mismatch;
    if (onLeave(staffId, card.date, st.bookings)) return 'On leave';
    const admin = isAdminCard(card);
    const clash = dayConflict({
      staffId, dateStr: card.date, startTime: card.start_time, endTime: card.end_time,
      cardId: card.theatre_activity_id, assignments: [...st.assignments, ...(ctx.otherSite || [])], unavailable, cardLabel,
      clashFree: admin,
      isClashFree: (a) => a.isAdmin,
    });
    if (clash) return clash;
    if (!admin) {
      const { hours, target } = loadOf(s, card.date, st.bookings);
      if (target > 0 && hours + shiftHours(card.date, card.start_time, card.end_time) > target + 0.01) return 'Would go past their FTE';
    }
    const days = shiftsByPerson(st.bookings.filter(b => b.staff_id === staffId)).get(staffId) || new Map();
    return patternProblem(rules, offShiftId, days, card.date, card.shift_id);
  };

  // Who could take each slot, kept up to date as people are booked.
  let st = state();
  const candidates = new Map(slots.map(slot => [slot.key, new Set(staff.filter(s => !problem(s.staff_id, slot, st)).map(s => s.staff_id))]));
  const open = new Set(slots.map(s => s.key));
  const unfilled = [];

  while (open.size) {
    // Fewest people first; then the earliest.
    const key = [...open].sort((a, b) => candidates.get(a).size - candidates.get(b).size
      || slotByKey.get(a).card.date.localeCompare(slotByKey.get(b).card.date)
      || (slotByKey.get(a).card.start_time || '').localeCompare(slotByKey.get(b).card.start_time || ''))[0];
    open.delete(key);
    const slot = slotByKey.get(key);
    const { card, place } = slot;
    const now = st;
    const people = [...candidates.get(key)]
      .filter(id => !problem(id, slot, now))
      .map(id => {
        const s = staffById.get(id);
        const load = loadOf(s, card.date, now.bookings);
        return { staffId: id, name: s.name, share: load.target > 0 ? load.hours / load.target : Infinity, casual: isCasual(s) };
      });
    if (!people.length) {
      unfilled.push(key);
      continue;
    }

    // Who needs this place to reach their FTE: without it, the most they
    // could get to is what they have plus the longest place they could take
    // on each other day of the fortnight that's still open.
    // Only for a pay fortnight wholly in view: with half of it off screen
    // everyone would look short.
    const { from, to } = payFortnightRange(card.date);
    const whole = (!ctx.viewFrom || from >= ctx.viewFrom) && (!ctx.viewTo || to <= ctx.viewTo);
    const behind = new Map();
    for (const p of whole ? people : []) {
      const load = loadOf(staffById.get(p.staffId), card.date, now.bookings);
      if (load.target <= 0) continue;
      const best = new Map();
      for (const other of open) {
        const o = slotByKey.get(other);
        if (o.card.date < from || o.card.date > to || !candidates.get(other).has(p.staffId) || isAdminCard(o.card)) continue;
        best.set(o.card.date, Math.max(best.get(o.card.date) || 0, slotHours(o)));
      }
      const reach = load.hours + [...best.entries()].filter(([d]) => d !== card.date).reduce((t, [, h]) => t + h, 0);
      // Short by a share of their FTE, so part-timers aren't always last.
      if (reach < load.target - 0.01) behind.set(p.staffId, (load.target - reach) / load.target);
    }
    const mostBehind = Math.max(0, ...behind.values());
    const pool = behind.size && !isAdminCard(card)
      ? people.filter(p => (behind.get(p.staffId) || 0) >= mostBehind - 0.001)
      : people;

    // Fairness with what's booked and suggested after today counted.
    const seen = new Set();
    const counted = st.assignments.filter(a => {
      const k = `${a.staff_id}|${a.date}`;
      if (seen.has(k) || a.on_call) return false;
      seen.add(k);
      return true;
    }).map(a => ({ staffId: a.staff_id, activityId: a.activityKey, date: a.date }));
    const history = withBookings(exposure, counted, todayStr);
    const fairness = buildFairness({ ...exposure, ...history });
    const dayBefore = addDays(card.date, -1);
    const yesterday = new Set(st.assignments
      .filter(a => a.date === dayBefore && a.card && sameJob(a.card, card))
      .map(a => a.staff_id));
    const activityKey = exposureKey(card.activity_id, place);
    const top = rankPeopleForPlace(pool, activityKey, card.date, fairness, history.statsByStaffActivity, yesterday)[0];

    const reason = [
      pool !== people ? 'needs it to reach their FTE' : top.solo ? 'the only one who can do it' : top.yesterday ? 'did this job yesterday' : 'fairest for this job',
      `${people.length} could take it`,
    ].join(' · ');
    drafts.push({ key, staffId: top.staffId, name: top.name, reason, moved: false });
    st = state();
    for (const other of open) {
      const set = candidates.get(other);
      if (set.has(top.staffId) && problem(top.staffId, slotByKey.get(other), st)) set.delete(top.staffId);
    }
  }

  // Keep days together: swap two suggestions' people when both still pass
  // every check and they end up with fewer stretches of work between them.
  // Only worth trying where one of them has a day on its own.
  const workDays = (staffId, bookings) => bookings
    .filter(b => b.staff_id === staffId && !b.on_call && !b.leave_code && b.shift_id !== offShiftId)
    .map(b => b.date);
  const alone = (staffId, dateStr, bookings) => {
    const days = new Set(workDays(staffId, bookings));
    return !days.has(addDays(dateStr, -1)) && !days.has(addDays(dateStr, 1));
  };
  const nameOf = (id) => staffById.get(id)?.name;
  // Hours short of FTE over the fortnights the slots are in.
  const shortBy = (staffId, bookings) => {
    const s = staffById.get(staffId);
    return fortnights.reduce((t, { from }) => {
      const { hours, target } = loadOf(s, from, bookings);
      return t + (target > 0 ? Math.max(0, target - hours) : 0);
    }, 0);
  };
  const trySwap = () => {
    for (let i = 0; i < drafts.length; i++) {
      for (let j = i + 1; j < drafts.length; j++) {
        const a = drafts[i];
        const b = drafts[j];
        if (a.staffId === b.staffId) continue;
        const slotA = slotByKey.get(a.key);
        const slotB = slotByKey.get(b.key);
        if (slotA.card.date === slotB.card.date) continue;
        if (!alone(a.staffId, slotA.card.date, st.bookings) && !alone(b.staffId, slotB.card.date, st.bookings)) continue;
        const others = drafts.filter((_, k) => k !== i && k !== j);
        const aToB = { ...b, staffId: a.staffId, name: nameOf(a.staffId) };
        const bToA = { ...a, staffId: b.staffId, name: nameOf(b.staffId) };
        if (problem(a.staffId, slotB, state(others))) continue;
        if (problem(b.staffId, slotA, state([...others, aToB]))) continue;
        const after = state([...others, aToB, bToA]);
        const before = stretches(workDays(a.staffId, st.bookings)) + stretches(workDays(b.staffId, st.bookings));
        const now = stretches(workDays(a.staffId, after.bookings)) + stretches(workDays(b.staffId, after.bookings));
        if (now >= before) continue;
        if (shortBy(a.staffId, after.bookings) > shortBy(a.staffId, st.bookings) + 0.01
          || shortBy(b.staffId, after.bookings) > shortBy(b.staffId, st.bookings) + 0.01) continue;
        const moved = { moved: true, reason: 'moved to keep their days together' };
        drafts = drafts.map((d, k) => (k === i ? { ...bToA, ...moved } : k === j ? { ...aToB, ...moved } : d));
        st = state();
        return true;
      }
    }
    return false;
  };
  let swaps = 0;
  while (swaps < MAX_SWAPS && trySwap()) swaps += 1;

  const shortfalls = [];
  for (const { from, to } of fortnights) {
    for (const s of staff) {
      if (hasLeft(s, from)) continue;
      const { target } = loadOf(s, from, st.bookings);
      const hours = hoursBooked(s.staff_id, from, to, st.bookings, leaveHours);
      if (target > 0 && hours < target - 0.01) shortfalls.push({ staffId: s.staff_id, name: s.name, from, to, hours, target });
    }
  }
  shortfalls.sort((a, b) => a.from.localeCompare(b.from) || (b.target - b.hours) - (a.target - a.hours) || a.name.localeCompare(b.name));

  return { drafts, unfilled, shortfalls };
}
