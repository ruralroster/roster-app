// ============================================================
// JOB-TYPE COLOURS
// ============================================================
//
// Matches the colours the department's own Excel roster
// (Rosters/innisfail/*.xlsx) already uses for each kind of job, so a card
// in the app reads the same as the cell it came from:
//   Emergency  — A1DBA2 ("Day 0800-1800 ED", "ED 0800 - 1800")
//   Ward       — B4C7E7 ("Day 0800-1800 WARD 1", "Ward 0800-1800")
//   Theatre    — 00B0F0 (OT, Dental, Endo, LSCS, Anaes clinic)
//   Maternity  — FF6161 ("Day 0800 - 1800 Maternity")
// Read off the 2026-10-12 and 2026-12-07 DRAFT files' cell fills.
// Clinic/Admin cells are left white on the sheet, so they get no colour
// here either.
//
// Each job type has two shades: `card` (pale, the location card's
// background) and `box` (the roster colour itself, the background of a
// person's name box on that card). Someone on call that day — for any
// on-call slot, whatever job the card is — keeps the job's box colour but
// gets an ON_CALL_BORDER outline: the roster's own on-call magenta
// (FF00FF, the "EDL + OC" / "Oncall + Anaes" cells), so the on-call person
// stands out while every ED box still reads as ED.
//
// There's no location "type" field in the schema, so the job type is a
// name-based heuristic over the location name, falling back to the
// activity name (e.g. the generic "Clinic" location running
// Anaesthetics reads as Theatre, same as "Anaes clinic" on the sheet).

export const JOB_COLOURS = {
  emergency: { label: 'Emergency', card: '#ECF8EC', border: '#5FAF61', box: '#A1DBA2' },
  ward: { label: 'Ward', card: '#F0F4FB', border: '#6F8FC9', box: '#B4C7E7' },
  theatre: { label: 'Theatre', card: '#E0F6FE', border: '#0091C7', box: '#7FD7F7' },
  maternity: { label: 'Maternity', card: '#FFEFEF', border: '#E04848', box: '#FFA6A6' },
};

export const ON_CALL_BORDER = '#FF00FF';

const NEUTRAL_CARD = { card: '#FFFFFF', border: '#D1D5DB', box: '#F3F4F6' };

function categoryForText(text) {
  if (!text) return null;
  if (/non.?clinical|\badmin\b/i.test(text)) return 'none';
  if (/\bed\b|emergency/i.test(text)) return 'emergency';
  if (/theatre|theater|\bot\b|endo|dental|surg|anaes|lscs|procedur/i.test(text)) return 'theatre';
  if (/maternity|obstet|\bobs\b|birth|labour/i.test(text)) return 'maternity';
  if (/\bward/i.test(text)) return 'ward';
  return null;
}

// 'emergency' | 'ward' | 'theatre' | 'maternity' | null
export function jobCategoryFor(locationName, activityName) {
  const fromLocation = categoryForText(locationName);
  if (fromLocation) return fromLocation === 'none' ? null : fromLocation;
  const fromActivity = categoryForText(activityName);
  return fromActivity && fromActivity !== 'none' ? fromActivity : null;
}

// Inline styles (not Tailwind classes) since the colours are the roster's
// exact hex values.
export function jobCardStyle(category) {
  const c = JOB_COLOURS[category] || NEUTRAL_CARD;
  return { backgroundColor: c.card, borderColor: c.border };
}

// The on-call border is an inset outline rather than a CSS border so it
// doesn't change the box's size, and doesn't clash with the Tailwind
// rings (box-shadow) used for "You" and the selected person. borderWidth
// in px — the staff view's larger name rows use a thicker one.
export function jobBoxStyle(category, onCall = false, borderWidth = 2) {
  const c = JOB_COLOURS[category] || NEUTRAL_CARD;
  const style = { backgroundColor: c.box, color: '#111827' };
  if (onCall) Object.assign(style, { outline: `${borderWidth}px solid ${ON_CALL_BORDER}`, outlineOffset: `-${borderWidth}px` });
  return style;
}

// Whether a person holds any on-call duty (duty_assignments) today — e.g.
// an anaesthetist on call tonight working a Ward shift still gets the
// border on their Ward card. Day roles that don't count as on call
// ("Anaesthetics (AM)") don't. dutyTypes: the department's duty_types
// rows; dutyKeys: the duty_type keys this person holds today.
export function holdsOnCallDuty(dutyKeys, dutyTypes) {
  if (!dutyKeys?.length) return false;
  return dutyKeys.some(key => {
    const dutyType = dutyTypes.find(dt => dt.key === key);
    return !!dutyType && dutyType.counts_as_on_call !== false;
  });
}
