import * as XLSX from 'xlsx';

// ============================================================
// GASTRO ROSTER EXCEL IMPORT (Cairns Gastroenterology)
// ============================================================
//
// A fifth layout (see rosterExcelImport.js's header for why each layout
// gets its own module): CHHHS's Gastroenterology Roster, confirmed
// 2026-11-22 against the 2026-27 FY workbook.
//
//   - One tab per four-week roster, named "R6 16.11.26" (its first Monday).
//     MASTER, Reference and Formatting tabs are left out. The dates come
//     from the tab's name, 28 days from column D: two tabs' own date rows
//     are broken (R11's start on a Thursday, R12's year reads 00).
//   - Rows are sessions, not people: column B the place (merged down),
//     column C the session ("AM", "PM", "AM 3", "PM 5", blank). Each cell is
//     who's in it, by code: "PB (G)" (initials, then G gastro / M medical /
//     R respiratory / S surgeon / NP nurse practitioner). "Reg (G)", "Reg 1
//     (G)", "AdT (G)", "AdT 2 (G)" are a registrar or advanced trainee slot
//     with nobody named: an empty place to fill (unnamed).
//   - The Reference tab decodes the codes: "Boyd, Peter | Gastro | PB (G)".
//   - On Call Endoscopy is the on-call slot of that name; Leave rows are
//     leave; Ward Round's "Who" row is the ward round ("Time Block" isn't
//     a person); column A is who edits that section, not who works it.
//   - AM 08:00-12:30, PM 13:00-17:00 (confirmed); a row with no session
//     (outreach, admin) is the whole day, 08:00-17:00.
//
// Output matches the other parsers' { rawLabel, days: [{ date, rawShift,
// resolvedShift, onCallDuties }] }, so it flows through importRosterWeek.

export const AM = { start: '08:00', end: '12:30' };
export const PM = { start: '13:00', end: '17:00' };
export const DAY = { start: '08:00', end: '17:00' };
export const ON_CALL_LABEL = 'On Call Endoscopy';
const FIRST_DAY_COL = 3; // D
const DAYS = 28;
const TAB_RE = /^R\d+\s+(\d{1,2})\.(\d{1,2})\.(\d{2})\s*$/;

// Place on the sheet -> where it goes in Rstar. Anything else comes back
// unmapped (Map… on the Import tab).
const PLACES = {
  'procedure room 1': { location: 'Procedure Room 1', activity: 'Endoscopy' },
  'procedure room 2': { location: 'Procedure Room 2', activity: 'Endoscopy' },
  'procedure room 3': { location: 'Procedure Room 3', activity: 'Endoscopy' },
  mano: { location: 'Manometry', activity: 'Manometry' },
  'pac/mano': { location: 'Manometry', activity: 'Manometry' },
  'ward round': { location: 'Ward', activity: 'Ward Round' },
  'cairns gastro clinic': { location: 'Cairns Gastro Clinic', activity: 'Clinic' },
  'director admin allocation': { location: 'Non-clinical', activity: 'Admin' },
  'atherton endoscopy': { location: 'Atherton', activity: 'Outreach Endoscopy' },
  'innisfail endoscopy': { location: 'Innisfail', activity: 'Outreach Endoscopy' },
  'mareeba endoscopy': { location: 'Mareeba', activity: 'Outreach Endoscopy' },
  'atherton gastro clinic': { location: 'Atherton', activity: 'Outreach Clinic' },
  'innisfail gastro clinic': { location: 'Innisfail', activity: 'Outreach Clinic' },
  'mossman gastro clinic': { location: 'Mossman', activity: 'Outreach Clinic' },
  'weipa outreach': { location: 'Weipa', activity: 'Outreach Clinic' },
  'yarrabah outreach': { location: 'Yarrabah', activity: 'Outreach Clinic' },
  'thursday island outreach': { location: 'Thursday Island', activity: 'Outreach Clinic' },
};
const ON_CALL_PLACE = 'on call endoscopy';
const LEAVE_PLACE = 'leave';
const LEAVE_CODE = 'AL';

const text = (v) => (v ?? '').toString().replace(/\s+/g, ' ').trim();
const key = (v) => text(v).toLowerCase();

// "PB (G)", "PB(G)" -> "PB(G)"; "Reg 1 (G)" -> "REG1(G)". null if not a code.
export function codeKey(cell) {
  const m = text(cell).match(/^([A-Za-z]+)\s*(\d*)\s*\(\s*([A-Za-z]+)\s*\)$/);
  return m ? `${m[1].toUpperCase()}${m[2]}(${m[3].toUpperCase()})` : null;
}
const PLACEHOLDER_RE = /^(REG|ADT)\d*\(/;
export const isPlaceholderCode = (k) => PLACEHOLDER_RE.test(k || '');

// "Boyd, Peter" -> "Peter Boyd"; "Gerard Bennett" stays.
export function personName(raw) {
  const t = text(raw);
  const m = t.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : t;
}

const SPECIALTY_RANK = { gastro: 'Gastroenterologist', medical: 'Physician', resp: 'Respiratory Physician', surg: 'Surgeon', 'nurse prac': 'Nurse Practitioner' };

// The Reference tab: code -> { name, specialty, rank }. Placeholder codes
// (Gastro AT 1, Gastro Reg 1) have no name and aren't people.
export function readReference(workbook) {
  const ws = workbook.Sheets.Reference;
  const map = new Map();
  if (!ws) return map;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  for (const r of rows) {
    const k = codeKey(r[2]);
    const name = personName(r[0]);
    if (!k || !name || isPlaceholderCode(k)) continue;
    const specialty = text(r[1]);
    map.set(k, { name, specialty, rank: SPECIALTY_RANK[specialty.toLowerCase()] || specialty });
  }
  return map;
}

// The same initials with the wrong letter ("RT (G)" for "RT (M)"): the one
// person with those initials, if there's only one.
function lookup(ref, k) {
  if (ref.has(k)) return ref.get(k);
  const initials = k.split('(')[0];
  const same = [...ref.entries()].filter(([code]) => code.split('(')[0] === initials);
  return same.length === 1 ? same[0][1] : null;
}

// The roster tabs, by first Monday: [{ sheetName, monday }] (YYYY-MM-DD).
export function getGastroSheets(workbook) {
  return workbook.SheetNames.map(sheetName => {
    const m = sheetName.trim().match(TAB_RE);
    if (!m) return null;
    return { sheetName, monday: `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
  }).filter(Boolean).sort((a, b) => a.monday.localeCompare(b.monday));
}

const ddmmyyyy = (iso, plus) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + plus);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

// Picker ranges for a tab: the four weeks, then each week.
export function getGastroWeekRanges(workbook, sheetName) {
  const tab = getGastroSheets(workbook).find(t => t.sheetName === sheetName);
  if (!tab) return [];
  return [
    { start: ddmmyyyy(tab.monday, 0), end: ddmmyyyy(tab.monday, 27), label: `All four weeks (${ddmmyyyy(tab.monday, 0)}–${ddmmyyyy(tab.monday, 27)})` },
    ...[0, 1, 2, 3].map(w => ({ start: ddmmyyyy(tab.monday, w * 7), end: ddmmyyyy(tab.monday, w * 7 + 6), label: `Week ${w + 1} (${ddmmyyyy(tab.monday, w * 7)}–${ddmmyyyy(tab.monday, w * 7 + 6)})` })),
  ];
}

const timesFor = (session) => {
  const s = key(session);
  if (s.startsWith('am')) return AM;
  if (s.startsWith('pm')) return PM;
  return DAY;
};

// Every session on a tab: [{ day (0-27), code, place, times }] plus leave
// and on call, in sheet order.
function readTab(workbook, sheetName) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  const start = rows.findIndex(r => /^refer/i.test(text(r[0])) || key(r[1]) === 'date roster confirmed');
  const entries = [];
  let place = '';
  for (let r = start + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    if (text(row[1])) place = text(row[1]);
    const session = text(row[2]);
    const placeKey = key(place);
    if (placeKey === 'ward round' && key(session) === 'time block') continue;
    for (let day = 0; day < DAYS; day++) {
      const k = codeKey(row[FIRST_DAY_COL + day]);
      if (!k) continue;
      entries.push({ day, code: k, raw: text(row[FIRST_DAY_COL + day]), placeKey, place, session, times: placeKey === 'ward round' ? AM : timesFor(session) });
    }
  }
  return entries;
}

// One tab, one range (getGastroWeekRanges index: 0 all four weeks, 1-4 a
// week) -> importRosterWeek's people: one per person (every date in the
// range, blank ones too, so a re-import replaces exactly those dates), and
// one unnamed entry per registrar / advanced trainee slot.
export function parseGastroRange(workbook, sheetName, rangeIndex = 0) {
  const tab = getGastroSheets(workbook).find(t => t.sheetName === sheetName);
  if (!tab) throw new Error(`"${sheetName}" isn't a roster tab`);
  const ref = readReference(workbook);
  const [first, count] = rangeIndex === 0 ? [0, DAYS] : [(rangeIndex - 1) * 7, 7];
  const inRange = (day) => day >= first && day < first + count;
  const dates = Array.from({ length: count }, (_, i) => ddmmyyyy(tab.monday, first + i));
  const people = new Map();
  const personFor = (label, extra) => {
    if (!people.has(label)) people.set(label, { rawLabel: label, ...extra, byDay: new Map() });
    return people.get(label);
  };

  for (const e of readTab(workbook, sheetName)) {
    if (!inRange(e.day)) continue;
    const placeholder = isPlaceholderCode(e.code);
    const who = placeholder ? null : lookup(ref, e.code);
    // Each registrar / AT slot is its own empty place, so two in a day stay two.
    const p = placeholder
      ? personFor(`${e.raw} · ${e.place} ${e.session} · ${e.day}`, { unnamed: true, section: 'rmo' })
      : personFor(who ? who.name : e.raw, { section: 'consultant', unknownCode: who ? null : e.raw });
    if (!p.byDay.has(e.day)) p.byDay.set(e.day, { segments: [], leave: false, onCall: false, unmapped: null, raw: [] });
    const d = p.byDay.get(e.day);
    d.raw.push(`${e.place}${e.session ? ` ${e.session}` : ''}`);
    if (e.placeKey === LEAVE_PLACE) { d.leave = true; continue; }
    if (e.placeKey === ON_CALL_PLACE) { d.onCall = true; continue; }
    const where = PLACES[e.placeKey];
    if (!where) { d.unmapped = d.unmapped || e.place; continue; }
    // The same place and times twice (two admin rows) is one session.
    if (!d.segments.some(s => s.location === where.location && s.activity === where.activity && s.start === e.times.start)) {
      d.segments.push({ ...where, start: e.times.start, end: e.times.end });
    }
  }

  return [...people.values()].map(p => ({
    rawLabel: p.rawLabel,
    section: p.section,
    unnamed: !!p.unnamed,
    unknownCode: p.unknownCode,
    days: dates.map((date, i) => {
      const d = p.byDay.get(first + i);
      if (!d) return { date, rawShift: '', resolvedShift: null };
      const resolvedShift = d.leave ? { leaveCode: LEAVE_CODE }
        : d.unmapped ? { unmapped: d.unmapped }
        : d.segments.length ? { segments: d.segments }
        : null;
      return { date, rawShift: d.raw.join(', '), resolvedShift, ...(d.onCall && !d.leave ? { onCallDuties: [ON_CALL_LABEL] } : {}) };
    }),
  }));
}

// Everyone in the Reference tab, for Check for Missing Staff: [{ rawLabel,
// name, code, specialty, rank, fte }]. Gastroenterologists start at 1.0
// FTE; the visiting specialties and nurse practitioners at 0 (on the
// roster, no FTE target, no login unless invited).
export function getGastroStaffRoster(workbook) {
  return [...readReference(workbook).entries()].map(([code, p]) => ({
    rawLabel: p.name, name: p.name, code, specialty: p.specialty, rank: p.rank, fte: /^gastro$/i.test(p.specialty) ? 1 : 0,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
