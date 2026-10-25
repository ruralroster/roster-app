// ============================================================
// ONE DAY'S COFFEE ORDER, AND WHO ORDERS IT
// ============================================================
//
// Shared by the Coffee Orders popup (staffRosterView.jsx) and the
// coffee-order Edge Function, which emails the order at 9:00 to whoever's
// on the ED late, emails them again when it changes, and pushes yesterday's
// ED on call at 8:15 if anyone has no order. The Edge Function can't import
// from src/, so this file and the three it imports (coffeeUtils.js,
// shiftSessionUtils.js, jobColours.js) are byte-for-byte copies in
// supabase/functions/_shared/. coffeeDay.test.js fails if they drift. Edit
// these, then copy them across.
//
// Imports carry their .js extension so the same file runs in Deno.

import { NO_COFFEE, NO_MILK, parseCoffeeOrder, coffeeAttention } from './coffeeUtils.js';
import { getSessionGroups } from './shiftSessionUtils.js';
import { jobCategoryFor } from './jobColours.js';

// Coffee is ordered at 10:30, so only the morning needs one.
export function worksMorning(shift, boundaries) {
  return getSessionGroups(shift, boundaries).includes('morning');
}

// The people working this morning, one each (someone can have several
// assignment rows), sorted by name.
// assignments: staff_assignments rows with staff(name, rank, coffee_order)
// and shifts(start_time, end_time) joined.
export function morningCoffeePeople(assignments, boundaries) {
  const byStaff = new Map();
  for (const a of assignments) {
    if (!a.staff_id || byStaff.has(a.staff_id) || !worksMorning(a.shifts, boundaries)) continue;
    byStaff.set(a.staff_id, { staff_id: a.staff_id, name: a.staff?.name, rank: a.staff?.rank, coffee_order: a.staff?.coffee_order });
  }
  return [...byStaff.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// "Flat White on Oat Milk + Xtra Shot", the wording the café gets.
export function coffeeLabel({ coffeeType, milkType, extraShot }) {
  const milkSuffix = milkType && milkType !== NO_MILK ? ` on ${milkType}` : '';
  return `${coffeeType}${milkSuffix}${extraShot ? ' + Xtra Shot' : ''}`;
}

// One line per distinct coffee with a count ("2 x Flat White on Whole
// Milk"): what's ordered from the café. An xtra-shot order is always its
// own line so the café doesn't miss it. Extras (locums, visitors) are
// tallied into the same counts.
// included: [{ coffeeType, milkType, extraShot }], people actually getting one.
export function summarizeCoffeeOrder(included, extras) {
  const counts = new Map();
  const add = (order, n) => {
    const key = `${order.coffeeType}|${order.milkType || ''}|${order.extraShot ? '1' : '0'}`;
    counts.set(key, (counts.get(key) || 0) + n);
  };
  included.forEach(person => add(person, 1));
  extras.forEach(extra => add({ coffeeType: extra.coffee_type, milkType: extra.milk_type, extraShot: extra.extra_shot }, extra.quantity));
  return [...counts.entries()].map(([key, count]) => {
    const [coffeeType, milkType, extraShot] = key.split('|');
    return `${count} x ${coffeeLabel({ coffeeType, milkType, extraShot: extraShot === '1' })}`;
  });
}

// The whole order for one morning, as the popup shows it by default
// (morning only, minus people taken off today, plus extras):
//   rows  - [{ name, coffee }] for the "Staff working today" table. A blank
//           saved order, or a visitor with no extra, shows as "Unknown".
//   lines - summarizeCoffeeOrder's lines.
//   total - coffees to order.
//   missing - coffeeAttention's list: who still needs an order.
// visitors: [{ name, start_time, end_time }] from today's Planner cards.
/** @param {{ assignments: any[], visitors?: any[], removedStaffIds?: string[], extras?: any[], boundaries?: any }} day */
export function dayCoffeeOrder({ assignments, visitors = [], removedStaffIds = [], extras = [], boundaries }) {
  const removed = new Set(removedStaffIds);
  const people = morningCoffeePeople(assignments, boundaries).filter(p => !removed.has(p.staff_id));
  const parsed = people.map(p => ({ ...p, ...parseCoffeeOrder(p.coffee_order) }));
  const included = parsed.filter(p => p.coffeeType !== NO_COFFEE);

  const missing = coffeeAttention({
    rostered: morningCoffeePeople(assignments, boundaries),
    visitorNames: visitors.filter(v => worksMorning(v, boundaries)).map(v => v.name),
    removedStaffIds,
    extras,
  });

  const rows = [
    ...parsed.map(p => ({
      name: p.name,
      coffee: !(p.coffee_order || '').trim() ? 'Unknown' : p.coffeeType === NO_COFFEE ? NO_COFFEE : coffeeLabel(p),
    })),
    ...extras.map(e => ({
      name: `${e.label || 'Extra'}${e.quantity > 1 ? ` (x${e.quantity})` : ''}`,
      coffee: coffeeLabel({ coffeeType: e.coffee_type, milkType: e.milk_type, extraShot: e.extra_shot }),
    })),
    ...missing.filter(m => m.kind === 'visitor').map(m => ({ name: `${m.name} (visitor)`, coffee: 'Unknown' })),
  ];

  return {
    rows,
    lines: summarizeCoffeeOrder(included, extras),
    total: included.length + extras.reduce((sum, e) => sum + e.quantity, 0),
    missing,
  };
}

// ============================================================
// WHO'S ON THE ED LATE
// ============================================================

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

// The department's ED on-call duty type: the same match as
// rosterExcelImport.js's dutyTypeForOnCallKind('ed', ...), which can't be
// imported here (it pulls in the Excel reader).
export function edOnCallDutyType(dutyTypes = []) {
  const matches = dutyTypes.filter(dt => dt.active !== false && dt.counts_as_on_call !== false && /\bed\b|emergency/i.test(dt.label || dt.key));
  return matches.length === 1 ? matches[0] : null;
}

// The consultant on the day's ED late: { staff_id, name } or null. If more
// than one, the one also in the ED on-call slot; never a guess.
// dayAssignments: with staff(name), locations(name), shifts joined.
// edOnCallStaffIds: who's in the ED on-call slot that day.
export function edLateConsultant(dayAssignments, edOnCallStaffIds = []) {
  const byStaff = new Map();
  dayAssignments.filter(isEdLateAssignment).forEach(a => byStaff.set(a.staff_id, { staff_id: a.staff_id, name: a.staff?.name }));
  const all = [...byStaff.values()];
  if (all.length === 1) return all[0];
  const onCall = all.filter(p => edOnCallStaffIds.includes(p.staff_id));
  return onCall.length === 1 ? onCall[0] : null;
}

// Who was ED on call overnight: whoever's in the ED on-call slot, or, when
// the slot is empty, the ED late consultant (the department rule in
// edLateOnCall.js). staff_id or null.
export function edOnCallStaffId(dayAssignments, edOnCallStaffIds = []) {
  if (edOnCallStaffIds.length === 1) return edOnCallStaffIds[0];
  if (edOnCallStaffIds.length > 1) return null;
  return edLateConsultant(dayAssignments)?.staff_id ?? null;
}
