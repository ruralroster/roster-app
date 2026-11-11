import * as XLSX from 'xlsx';

// ============================================================
// SHIFT-LIST ROSTER EXCEL IMPORT (Atherton)
// ============================================================
//
// A third layout alongside rosterExcelImport.js (classic) and
// edRosterExcelImport.js (ED shift codes) — see rosterExcelImport.js's
// header for why each layout gets its own module. This one is the
// export from Atherton's rostering system (Atherton - Medicine | Roster,
// confirmed 2026-11-11 against month and week exports):
//
//   - Row 1 the title, row 2 "Exported Wednesday, November 11th, 2026 @
//     ...", row 4 the dates ("Mon 9, Nov" — no year, so it comes from the
//     export line), one column per day from B. A sheet can cover any
//     number of days (a week, 9 days, a month); a file can have several.
//   - Column A from row 5: a role heading ("Senior Medical Officer",
//     "Staff Specialist Physician", "No Role") or a person. A person is
//     "Surname, First" followed by role, "FTE 80%" and a phone number on
//     their own lines — or, in older exports, just "BarrieA". The same
//     person can appear under their role and again under "No Role"; their
//     days are merged.
//   - Each day's cell holds one or more shift names as separate pieces of
//     text with nothing between them ("Remote On-Call Obstetrics" then
//     "Ward - South - SMO"), so they're read piece by piece, never split
//     on the joined text. A piece can carry its own hours on a second line
//     ("Chemotherapy\n08:00 - 13:00"), and newer exports add a
//     "No Location" line to every one, which is ignored. "Available" /
//     "Unavailable" are availability, not shifts.
//
// Each shift name resolves (DEFAULT_CODES, else the officer's saved code
// mappings) to a location, activity, hours and — because ED Flow and ED
// Fast Track share a location, activity and hours — the job it is. On-call
// pieces become that day's onCallDuties, matched to the department's
// on-call slots by name in importRosterWeek. Anything unknown comes back
// `unmapped` for the import tab's Map… button, never guessed at.
//
// Output matches the other parsers' { rawLabel, days: [{ date, rawShift,
// resolvedShift }] }, so it flows through the same importRosterWeek.

const DATE_ROW = 3; // 0-indexed row 4
const FIRST_PERSON_ROW = 4; // 0-indexed row 5
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = { start: '08:00', end: '16:30' };

// Atherton's shift names, from its month export and its shift times
// (ED Day 08:00–16:30, ED Mid 10:30–19:00, ED Late 1 13:30–22:00, ED Late 2
// 15:30–00:00, Ward/Anaesthetics/Obstetrics Day 08:00–16:30). Names are
// the department's own, set up with the department in Settings.
const ED = { location: 'Emergency', activity: 'Emergency Department Cover' };
const at = (base, job, times = DAY) => ({ ...base, job, start: times.start, end: times.end });
const DEFAULT_CODES = {
  'ED Flow SMO - WD': at(ED, 'ED Flow'),
  'ED Flow SMO - WE': at(ED, 'ED Flow'),
  'ED SMO': at(ED, 'ED Flow'),
  'ED Fast Track - WD': at(ED, 'ED Fast Track'),
  'ED Fast Track - WE': at(ED, 'ED Fast Track'),
  'ED Mid Shift': at(ED, 'ED Mid', { start: '10:30', end: '19:00' }),
  'ED Late Shift Senior': at(ED, 'ED Late 1', { start: '13:30', end: '22:00' }),
  'ED Late Shift 2 Senior': at(ED, 'ED Late 2', { start: '15:30', end: '00:00' }),
  'Late Junior Cover': at(ED, 'Late Junior Cover', { start: '14:00', end: '21:30' }),
  'Ward - North - SMO': at({ location: 'Ward North', activity: 'Ward Care Cover' }, 'Ward North'),
  'North Ward': at({ location: 'Ward North', activity: 'Ward Care Cover' }, 'Ward North'),
  'Ward - South - SMO': at({ location: 'Ward South', activity: 'Ward Care Cover' }, 'Ward South'),
  'Ward - SMO - WE': at({ location: 'Wards (Weekend Cover)', activity: 'Ward Care Cover' }, 'Weekend Ward'),
  'Physician - Ward/Clinic': at({ location: 'Medical', activity: 'Physician' }, 'Physician Ward/Clinic'),
  'Physician - Mareeba': at({ location: 'Mareeba', activity: 'Physician' }, 'Physician Mareeba'),
  'Physician - Endoscopist': at({ location: 'Endoscopy', activity: 'Endoscopy' }, 'Endoscopy'),
  'Anaesthetics Endoscopy': at({ location: 'Endoscopy', activity: 'Endoscopy' }, 'Endoscopy'),
  'Gen Surg': at({ location: 'General Theatre', activity: 'General Surgery' }, 'General Surgery'),
  'LSCS': at({ location: 'General Theatre', activity: 'Obstetric Theatre' }, 'LSCS'),
  'LSCS + D&C': at({ location: 'General Theatre', activity: 'Obstetric Theatre' }, 'LSCS'),
  'Gynae': at({ location: 'General Theatre', activity: 'Gynaecological Surgery' }, 'Gynae'),
  'Orthopaedics': at({ location: 'General Theatre', activity: 'Orthopaedics' }, 'Orthopaedics'),
  'Minor Ops Theatre': at({ location: 'General Theatre', activity: 'Minor Ops Theatre' }, 'Minor Ops Theatre'),
  'Pre-Anaesthesia Clinic': at({ location: 'Clinic', activity: 'Anaesthetics Clinic' }, 'Pre-Anaesthesia Clinic'),
  'Obstetrics': at({ location: 'Maternity', activity: 'Obstetrics' }, 'Obstetrics'),
  'Chemotherapy': at({ location: 'Clinic', activity: 'Chemotherapy' }, 'Chemotherapy'),
  'PICC': at({ location: 'Clinic', activity: 'PICC' }, 'PICC'),
  'Minor Ops Clinic': at({ location: 'Clinic', activity: 'Minor Ops Clinic' }, 'Minor Ops Clinic'),
  'Fracture Clinic': at({ location: 'Clinic', activity: 'Fracture Clinic' }, 'Fracture Clinic'),
  'Director of Medical Services': at({ location: 'Non-clinical', activity: 'Admin' }, 'Director of Medical Services'),
  'Rostering': at({ location: 'Non-clinical', activity: 'Admin' }, 'Rostering'),
  'Non-Clinical - half day': at({ location: 'Non-clinical', activity: 'Admin' }, 'Non-clinical Half Day', { start: '08:00', end: '12:00' }),
  'Case Conference': at({ location: 'Non-clinical', activity: 'Admin' }, 'Case Conference', { start: '08:00', end: '12:00' }),
};

// On-call pieces -> the on-call slot's name in Settings → Duty Types. Any
// other piece that reads as on call ("Remote On-Call Paeds") is matched to
// a slot of exactly its own name, so a new kind needs only that slot.
const DEFAULT_ON_CALL = {
  'Remote On-Call Anaesthetics': 'Anaesthetics On-Call',
  'Remote On-Call Obstetrics': 'Obstetrics On-Call',
  'Standby On-Call': 'Standby On-Call',
};
const ON_CALL_RE = /on.?call/i;

// Role heading (or a person's role line) -> the grade a new staff
// record's rank is suggested from (the import tab picks the department's
// own rank for it).
const ROLE_GRADES = [
  [/senior medical officer|staff specialist|consultant|physician/i, 'senior'],
  [/registrar/i, 'registrar'],
  [/house officer|resident|\bpho\b|\bsho\b|\brmo\b/i, 'house officer'],
  [/intern/i, 'intern'],
];
const gradeForRole = (role) => (ROLE_GRADES.find(([re]) => re.test(role || '')) || [])[1] || null;

// Whitespace inside a shift name isn't consistent ("Ward  - SMO - WE").
const codeKey = (s) => (s || '').replace(/\s+/g, ' ').trim();

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// A cell's pieces of text: its rich-text runs when it has them (SheetJS
// keeps them as cell.r), else its whole value.
export function cellPieces(cell) {
  if (!cell) return [];
  if (typeof cell.r === 'string' && cell.r.includes('<r>')) {
    return (cell.r.match(/<r>[\s\S]*?<\/r>/g) || [])
      .map(run => unescapeXml((run.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '').replace(/\r/g, '').trim())
      .filter(Boolean);
  }
  const v = cell.w ?? cell.v;
  return v === undefined || v === null || `${v}`.trim() === '' ? [] : [`${v}`.replace(/\r/g, '').trim()];
}

// "Remote On-Call Obstetrics" -> { code, onCall }; "Chemotherapy\n08:00 -
// 13:00" -> { code: 'Chemotherapy', start: '08:00', end: '13:00' }.
function readPiece(piece) {
  const [first, ...rest] = piece.split('\n').map(s => s.trim()).filter(Boolean);
  const code = codeKey(first);
  const times = rest.join(' ').match(/(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)/);
  return {
    code,
    start: times ? `${times[1].padStart(2, '0')}:${times[2]}` : null,
    end: times ? `${times[3].padStart(2, '0')}:${times[4]}` : null,
  };
}

const DEFAULT_KEYED = Object.fromEntries(Object.entries(DEFAULT_CODES).map(([k, v]) => [codeKey(k), v]));

// One shift name -> what it is. codeMap: the officer's saved code mappings
// ({ code: { segments: [...] } | { leaveCode } }), which win over the
// defaults.
export function resolveShiftListCode(rawCode, codeMap = {}) {
  const { code, start, end } = readPiece(rawCode || '');
  if (!code) return null;
  if (/^available$/i.test(code)) return { availability: true };
  if (/^unavailable$/i.test(code)) return { availability: false };
  const mapped = codeMap[code] || codeMap[rawCode];
  if (mapped) {
    if (mapped.leaveCode) return mapped;
    const seg = mapped.segments?.[0];
    if (seg) return { segments: [{ ...seg, start: start || seg.start, end: end || seg.end }] };
  }
  if (DEFAULT_ON_CALL[code] || ON_CALL_RE.test(code)) return { onCall: DEFAULT_ON_CALL[code] || code };
  const known = DEFAULT_KEYED[code];
  if (known) return { segments: [{ ...known, start: start || known.start, end: end || known.end }] };
  return { unmapped: code };
}

function sheetCells(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws['!ref']) return null;
  return { ws, range: XLSX.utils.decode_range(ws['!ref']) };
}

const cellAt = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];

// The export line's year, for dates that only say "Mon 9, Nov". A date
// more than six months from the export's own month belongs to the year
// either side (a December export listing January).
function exportDate(ws) {
  const text = cellPieces(cellAt(ws, 1, 0)).join(' ');
  const year = parseInt((text.match(/(20\d\d)/) || [])[1], 10);
  const month = MONTHS.findIndex(m => new RegExp(`\\b${m}`, 'i').test(text));
  return { year: Number.isNaN(year) ? new Date().getFullYear() : year, month: month < 0 ? null : month };
}

const pad = (n) => `${n}`.padStart(2, '0');

// Column index -> "DD/MM/YYYY", for each date in row 4.
function sheetDates(ws, range) {
  const { year, month: exportMonth } = exportDate(ws);
  const dates = new Map();
  for (let c = 1; c <= range.e.c; c++) {
    const text = cellPieces(cellAt(ws, DATE_ROW, c)).join(' ');
    const m = text.match(/(\d{1,2}),?\s*([A-Za-z]{3})/);
    if (!m) continue;
    const month = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
    if (month < 0) continue;
    let y = year;
    if (exportMonth !== null && month < exportMonth - 6) y += 1;
    if (exportMonth !== null && month > exportMonth + 6) y -= 1;
    dates.set(c, `${pad(m[1])}/${pad(month + 1)}/${y}`);
  }
  return dates;
}

// Column A -> a person, or null for a heading / blank. "Barrie, Angela" /
// role / "FTE 80%" / phone, or an older export's bare "BarrieA".
export function readPersonLabel(pieces) {
  const lines = pieces.flatMap(p => p.split('\n')).map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const [first, ...rest] = lines;
  let name = null;
  const comma = first.match(/^([^,]+),\s*(.+)$/);
  if (comma) name = `${comma[2].trim()} ${comma[1].trim()}`;
  else if (/^[A-Z][A-Za-z'-]*[a-z][A-Z]$/.test(first)) {
    // "VanBeekhuizenB" -> "B Van Beekhuizen"
    const surname = first.slice(0, -1).replace(/([a-z])([A-Z])/g, '$1 $2');
    name = `${first.slice(-1)} ${surname}`;
  }
  if (!name) return null;
  const fteLine = rest.find(l => /^FTE\b/i.test(l));
  const fteMatch = fteLine && fteLine.match(/(\d+(?:\.\d+)?)\s*%/);
  const phone = rest.find(l => /^[\d ()+-]{8,}$/.test(l)) || '';
  const role = rest.find(l => l !== fteLine && l !== phone) || '';
  return { name, role, fte: fteMatch ? parseFloat(fteMatch[1]) / 100 : null, phone };
}

// Every person in every sheet, with their days merged across sheets and
// across the role / "No Role" listings: name -> { person, byDate: Map(date
// -> pieces) }.
function readWorkbook(workbook) {
  const people = new Map();
  const allDates = new Set();
  for (const sheetName of workbook.SheetNames) {
    const sheet = sheetCells(workbook, sheetName);
    if (!sheet) continue;
    const { ws, range } = sheet;
    const dates = sheetDates(ws, range);
    dates.forEach(d => allDates.add(d));
    let section = '';
    for (let r = FIRST_PERSON_ROW; r <= range.e.r; r++) {
      const labelPieces = cellPieces(cellAt(ws, r, 0));
      if (labelPieces.length === 0) continue;
      const person = readPersonLabel(labelPieces);
      if (!person) {
        section = labelPieces.join(' ').trim();
        continue;
      }
      const key = person.name.toLowerCase();
      if (!people.has(key)) people.set(key, { person: { ...person, role: person.role || '' }, section, byDate: new Map() });
      const entry = people.get(key);
      // A fuller listing (with role, FTE and phone) fills in a bare one.
      if (!entry.person.role && person.role) entry.person = { ...person };
      if (!entry.section || /no role/i.test(entry.section)) entry.section = section || entry.section;
      dates.forEach((date, c) => {
        const pieces = cellPieces(cellAt(ws, r, c));
        if (pieces.length === 0) return;
        entry.byDate.set(date, [...(entry.byDate.get(date) || []), ...pieces]);
      });
    }
  }
  return { people, allDates };
}

const toIso = (ddmmyyyy) => {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m}-${d}`;
};

// What the week picker offers: the whole file first, then each
// Monday-to-Sunday week it touches. { start, end, label, dates }.
export function getShiftListDateRanges(workbook) {
  const { allDates } = readWorkbook(workbook);
  const sorted = Array.from(allDates).sort((a, b) => toIso(a).localeCompare(toIso(b)));
  if (sorted.length === 0) return [];
  const ranges = [{ start: sorted[0], end: sorted[sorted.length - 1], label: `Whole file (${sorted[0]}–${sorted[sorted.length - 1]})`, dates: sorted }];
  const weeks = new Map();
  for (const d of sorted) {
    const date = new Date(`${toIso(d)}T00:00:00`);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(d);
  }
  Array.from(weeks.values()).forEach((ds, i) => {
    ranges.push({ start: ds[0], end: ds[ds.length - 1], label: `Week ${i + 1} (${ds[0]}–${ds[ds.length - 1]})`, dates: ds });
  });
  return ranges;
}

// One day's pieces -> the resolvedShift importRosterWeek reads: every
// shift as a segment, availability, and the day's on-call slots. The
// first unknown name makes the day `unmapped` (with `within`), so it's
// fixed with Map… before anything that day is written.
function resolveDay(pieces, codeMap) {
  const segments = [];
  const onCallDuties = [];
  let availability;
  for (const piece of pieces) {
    const resolved = resolveShiftListCode(piece, codeMap);
    if (!resolved) continue;
    if (resolved.unmapped) return { resolvedShift: { unmapped: resolved.unmapped, within: pieces.length > 1 ? pieces.map(p => readPiece(p).code).join(' + ') : undefined }, onCallDuties: [] };
    if (resolved.onCall) onCallDuties.push(resolved.onCall);
    else if (resolved.availability !== undefined) availability = resolved.availability;
    else if (resolved.leaveCode) return { resolvedShift: resolved, onCallDuties };
    else segments.push(...resolved.segments);
  }
  const resolvedShift = segments.length || availability !== undefined
    ? { ...(segments.length ? { segments } : {}), ...(availability !== undefined && !segments.length ? { availability } : {}) }
    : null;
  return { resolvedShift, onCallDuties };
}

// The chosen range (getShiftListDateRanges index) -> importRosterWeek's
// people. Each person carries every date in the range (blank ones too),
// so a re-import replaces exactly those dates.
export function parseShiftListRange(workbook, rangeIndex, codeMap = {}) {
  const range = getShiftListDateRanges(workbook)[rangeIndex];
  if (!range) throw new Error('No dates found in this file');
  const { people } = readWorkbook(workbook);
  return Array.from(people.values()).map(({ person, section, byDate }) => ({
    rawLabel: person.name,
    section,
    fte: person.fte,
    days: range.dates.map(date => {
      const pieces = byDate.get(date) || [];
      const { resolvedShift, onCallDuties } = resolveDay(pieces, codeMap);
      return {
        date,
        rawShift: pieces.map(p => p.split('\n').map(l => l.trim()).filter(l => l && !/^no location$/i.test(l)).join(' ')).join(' + '),
        resolvedShift,
        onCallDuties,
      };
    }),
  }));
}

// Everyone in the file, for the "missing staff" step: full name, FTE,
// phone, and the grade their role suggests (gradeForRole), for the import
// tab to turn into one of the department's own ranks.
export function getShiftListStaffRoster(workbook) {
  const { people } = readWorkbook(workbook);
  return Array.from(people.values())
    .map(({ person, section }) => ({
      name: person.name,
      fte: person.fte,
      phone: person.phone,
      role: person.role || section,
      grade: gradeForRole(person.role || section),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
