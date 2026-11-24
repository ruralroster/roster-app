import * as XLSX from 'xlsx';

// ============================================================
// MAREEBA ROSTER EXCEL IMPORT
// ============================================================
//
// A sixth layout (see rosterExcelImport.js's header for why each layout
// gets its own module): Mareeba Hospital's four-weekly roster, confirmed
// 2026-11-24 against "ROSTER - 23rd November 2026 to 19th December 2026".
//
//   - Days down, people across. Column N is the weekday, O the day of the
//     month; the header above N says the months ("Nov 26 - Dec 26"), so
//     the dates run on from the first row (a row that isn't a day, e.g.
//     "Term 5.2 Commences", is skipped). Columns A-L are daily counts and
//     are left out.
//   - From column P, each column is a person ("SMO Toby Hopton", "Dr Jane
//     Citizen (Locum)", "Mel Green - NP") or one of:
//       a gap to fill ("Second SMO on Ward", "Shifts to be filled",
//         "Critical Shifts to fill", "Second PHO", "jdoc To be confirmed"):
//         empty places, senior in the SMO half, junior after it;
//       a back-up on-call slot ("ED Back up", "Obs Back-up", "Anaest
//         Backup"), each day's cell a first name ("Pip", "Rachel B");
//       "Visiting Surgeon": sessions (Endo, PAC, Dental, Surg Clinic) as
//         cards with nobody booked.
//     The junior half starts at the first "Second PHO" column.
//   - The row under the days gives each person's FTE ("0.75", "Casual").
//   - A cell is "<where> <hh:mm-hh:mm>" ("Emergency 12:30-2200", "ED:07:45 -
//     16:15", "L: 1230-2130", "N:2100-0830", "Ward/Ward 0745-1715"), leave
//     ("Rec Leave", "LSL", "PDL", "Mat Leave", "Carer's Leave"), or "Not
//     Available"/"NA". Anything else (Travel, notes) comes back unmapped
//     for Map… on the Import tab. Cell colours (overtime, shift change) are
//     left out.
//   - Main shifts go on Mareeba's standard shifts for the grade (confirmed
//     2026-11-24): SMO day 07:45-17:15, SMO ED late 12:30-22:00, PHO day
//     07:45-16:45, PHO late 12:30-21:30, PHO night 21:00-08:30. Admin, CST,
//     part days (under 8 hours) and the nurse practitioner keep their
//     exact hours.
//
// Output matches the other parsers' { rawLabel, days: [{ date, rawShift,
// resolvedShift, onCallDuties }] }, so it flows through importRosterWeek.

export const MAREEBA_SHIFTS = {
  smoDay: { start: '07:45', end: '17:15' },
  smoLate: { start: '12:30', end: '22:00' },
  phoDay: { start: '07:45', end: '16:45' },
  phoLate: { start: '12:30', end: '21:30' },
  phoNight: { start: '21:00', end: '08:30' },
};
export const SMO_ACTIVITY = 'SMO Cover';
export const PHO_ACTIVITY = 'PHO Cover';
export const VISITING_ACTIVITY = 'Visiting Surgeon';
export const BACKUP_LABELS = { ed: 'ED Back-up', obs: 'Obs Back-up', anaes: 'Anaesthetic Back-up' };

const FIRST_PERSON_COL = 15; // P
const WEEKDAY_COL = 13; // N
const DAY_COL = 14; // O
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TIME_RE = /(\d{1,2})[:.]?(\d{2})\s*-\s*(\d{1,2})[:.]?(\d{2})/;
const NON_CLINICAL = 'Non-clinical';

const text = (v) => (v ?? '').toString().replace(/\s+/g, ' ').trim();
const key = (v) => text(v).toLowerCase();

// Where a cell's first word or two says the day is spent.
const PLACES = [
  [/^(emergency|ed|l|n)$/, 'Emergency'],
  [/^east$/, 'East Ward'],
  [/^west$/, 'West Ward'],
  [/^ward/, 'Ward'],
  [/^(lg|lotus)/, 'Lotus Glen'],
  [/^gp\/admin/, NON_CLINICAL],
  [/^gp/, 'GP Clinic'],
  [/^mat/, 'Maternity'],
  [/^(theatre|surg theatre|surgical ot|anaesthetics)/, 'Theatre'],
  [/^surg clinic/, 'Surgical Clinic'],
  [/^pac/, 'PAC Clinic'],
  [/^dental/, 'Dental'],
  [/^endo/, 'Theatre'],
  [/^dimbulah/, 'Dimbulah'],
  [/^ost/, 'OST Remote'],
  [/^(admin|non clinical|cst|concilliation|education)/, NON_CLINICAL],
];
export function placeFor(label) {
  const k = key(label).replace(/[:\s]+$/, '');
  const hit = PLACES.find(([re]) => re.test(k));
  return hit ? hit[1] : null;
}

const LEAVE = [
  [/^(na\/)?rec leave/, 'AL'],
  [/^lsl/, 'LSL'],
  [/^mat leave/, 'ML'],
  [/^pdl/, 'PDL'],
  [/^carer'?s leave/, 'CL'],
  [/^leave/, 'AL'],
];
const leaveFor = (v) => LEAVE.find(([re]) => re.test(key(v)))?.[1] || null;
const NOT_AVAILABLE_RE = /^(not available|na)$/i;

const hhmm = (h, m) => `${h.padStart(2, '0')}:${m}`;
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const lengthOf = ({ start, end }) => { let d = minutes(end) - minutes(start); if (d <= 0) d += 24 * 60; return d / 60; };

// The standard shift for a main shift, or the exact hours (non-clinical,
// part days, the nurse practitioner).
export function standardMareebaHours(section, place, hours, exact) {
  if (exact || place === NON_CLINICAL || lengthOf(hours) < 8) return hours;
  const s = minutes(hours.start);
  if (section === 'rmo') {
    if (s >= 19 * 60) return MAREEBA_SHIFTS.phoNight;
    if (s >= 10 * 60) return MAREEBA_SHIFTS.phoLate;
    return MAREEBA_SHIFTS.phoDay;
  }
  if (s >= 10 * 60 && place === 'Emergency') return MAREEBA_SHIFTS.smoLate;
  return s < 10 * 60 ? MAREEBA_SHIFTS.smoDay : hours;
}

// One cell -> what importRosterWeek reads.
export function resolveMareebaCell(value, section, exact = false) {
  const v = text(value);
  if (!v) return null;
  const leave = leaveFor(v);
  if (leave) return { leaveCode: leave };
  if (NOT_AVAILABLE_RE.test(v)) return { availability: false };
  const m = v.match(TIME_RE);
  if (!m) {
    // A place with no hours ("LG/LG"): that grade's standard day there.
    const place = placeFor(v);
    if (place && place !== NON_CLINICAL) {
      const hours = section === 'rmo' ? MAREEBA_SHIFTS.phoDay : MAREEBA_SHIFTS.smoDay;
      return { segments: [{ location: place, activity: section === 'rmo' ? PHO_ACTIVITY : SMO_ACTIVITY, start: hours.start, end: hours.end }] };
    }
    return { unmapped: v };
  }
  const place = placeFor(v.slice(0, m.index));
  if (!place) return { unmapped: v.slice(0, m.index).replace(/[:\s]+$/, '') || v };
  const hours = standardMareebaHours(section, place, { start: hhmm(m[1], m[2]), end: hhmm(m[3], m[4]) }, exact);
  const activity = place === NON_CLINICAL ? 'Admin Time' : section === 'rmo' ? PHO_ACTIVITY : SMO_ACTIVITY;
  return { segments: [{ location: place, activity, start: hours.start, end: hours.end }] };
}

// "SMO Toby Hopton" -> { name, locum, casual, np }.
export function cleanMareebaName(raw) {
  const t = text(raw);
  const locum = /locum/i.test(t);
  const casual = /casual/i.test(t);
  const np = /-\s*np\b/i.test(t);
  const name = t
    .replace(/\((locum|casual)\)/ig, ' ')
    .replace(/\b(locum|tbc)\b/ig, ' ')
    .replace(/-\s*(np|jdoc)\b/ig, ' ')
    .replace(/^(?:(?:dr|smo|facem|dms)\.?\s+)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, locum, casual, np };
}

const columnKind = (header) => {
  const k = key(header);
  if (!k) return null;
  if (/ed back.?up/.test(k)) return { kind: 'backup', label: BACKUP_LABELS.ed };
  if (/obs back.?up/.test(k)) return { kind: 'backup', label: BACKUP_LABELS.obs };
  if (/anaest?h?e?t?i?c? ?back.?up/.test(k)) return { kind: 'backup', label: BACKUP_LABELS.anaes };
  if (/visiting surgeon/.test(k)) return { kind: 'visiting' };
  if (/fill|second (smo|pho)|to be confirmed|supervisor/.test(k)) return { kind: 'gap' };
  return { kind: 'person' };
};

// The sheet's layout: header row, day rows with their dates, FTE row and
// each column's kind.
function readLayout(workbook, sheetName) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  const dayRow = (r) => WEEKDAYS.includes(key(rows[r]?.[WEEKDAY_COL]).toUpperCase()) && /^\d{1,2}$/.test(text(rows[r]?.[DAY_COL]));
  const first = rows.findIndex((_, r) => dayRow(r));
  if (first < 1) throw new Error('No days found: expecting weekdays in column N and day numbers in column O');
  const headerRow = first - 1;
  const header = rows[headerRow] || [];
  const months = key(header[WEEKDAY_COL]).match(/([a-z]{3})\w*\s+(\d{2})/);
  if (!months || !MONTHS.includes(months[1])) throw new Error(`Can't read the months above column N ("${text(header[WEEKDAY_COL])}")`);
  let month = MONTHS.indexOf(months[1]);
  let year = 2000 + Number(months[2]);
  const days = [];
  let last = null;
  for (let r = first; r < rows.length; r++) {
    if (!dayRow(r)) {
      if (days.length && rows.slice(r, r + 3).every((_, i) => !dayRow(r + i))) break;
      continue;
    }
    const d = Number(text(rows[r][DAY_COL]));
    if (last !== null && d < last) { month += 1; if (month > 11) { month = 0; year += 1; } }
    last = d;
    days.push({ row: r, date: `${String(d).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}` });
  }
  const lastDayRow = days[days.length - 1].row;
  const fteRow = rows.slice(lastDayRow + 1, lastDayRow + 4).find(r => r.slice(FIRST_PERSON_COL).some(v => /^(\d*\.?\d+|casual)$/i.test(text(v)))) || [];
  let juniorFrom = header.findIndex((h, c) => c >= FIRST_PERSON_COL && /second pho/i.test(text(h)));
  if (juniorFrom < 0) juniorFrom = Infinity;
  const columns = [];
  for (let c = FIRST_PERSON_COL; c < header.length; c++) {
    const kind = columnKind(header[c]);
    if (kind) columns.push({ col: c, header: text(header[c]), section: c >= juniorFrom ? 'rmo' : 'consultant', fte: text(fteRow[c]), ...kind });
  }
  return { rows, days, columns };
}

export function getMareebaSheets(workbook) {
  return workbook.SheetNames.filter(name => {
    try { readLayout(workbook, name); return true; } catch { return false; }
  });
}

// Picker ranges: the whole sheet, then each week.
export function getMareebaWeekRanges(workbook, sheetName) {
  const { days } = readLayout(workbook, sheetName);
  const ranges = [{ start: days[0].date, end: days[days.length - 1].date, label: `Whole roster (${days[0].date}–${days[days.length - 1].date})`, from: 0, count: days.length }];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    ranges.push({ start: week[0].date, end: week[week.length - 1].date, label: `Week ${i / 7 + 1} (${week[0].date}–${week[week.length - 1].date})`, from: i, count: week.length });
  }
  return ranges;
}

const NICKNAMES = {
  andy: ['andrew'], drew: ['andrew'], pete: ['peter'], nick: ['nicolas', 'nicholas'], cass: ['cassandra'],
  aidy: ['adrian'], ade: ['adrian'], liz: ['elizabeth'], beth: ['elizabeth'], kate: ['katherine', 'catherine'],
  tom: ['thomas'], tim: ['timothy'], sam: ['samuel', 'samantha'], dan: ['daniel'], ben: ['benjamin'],
  mike: ['michael'], chris: ['christopher', 'christine'], jen: ['jennifer'], matt: ['matthew'], rob: ['robert'],
};

// A back-up cell's name ("Pip", "Rachel B", "Salome from 1700", "(no am
// cover) Andy") -> the full name of the one person it can mean among the
// roster's own people, or null if it could mean more than one (Map… on
// the Import tab then remembers who it is).
export function resolveBackupName(cell, people) {
  const cleaned = text(cell).replace(/\([^)]*\)/g, ' ').replace(/\bfrom\b.*$/i, '').replace(/\s+/g, ' ').trim();
  const [firstRaw, initialRaw] = cleaned.split(' ');
  if (!firstRaw) return null;
  const first = firstRaw.toLowerCase();
  const initial = (initialRaw || '').replace(/\W/g, '').toLowerCase().slice(0, 1);
  const firsts = new Set([first, ...(NICKNAMES[first] || [])]);
  const fits = (exactOnly) => people.filter(p => {
    const [f, ...rest] = p.toLowerCase().split(' ');
    const surname = rest[rest.length - 1] || '';
    return (firsts.has(f) || (!exactOnly && f.startsWith(first))) && (!initial || surname.startsWith(initial));
  });
  // An exact first name (or nickname) first; only then a shortened one.
  const exact = fits(true);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const partial = fits(false);
  return partial.length === 1 ? partial[0] : null;
}

// One sheet, one range (getMareebaWeekRanges index) -> importRosterWeek's
// people: everyone named (every date in the range, so a re-import replaces
// exactly those), plus unnamed gaps and visiting-surgeon sessions.
export function parseMareebaRange(workbook, sheetName, rangeIndex = 0) {
  const { rows, days, columns } = readLayout(workbook, sheetName);
  const range = getMareebaWeekRanges(workbook, sheetName)[rangeIndex] || getMareebaWeekRanges(workbook, sheetName)[0];
  const shown = days.slice(range.from, range.from + range.count);
  const personCols = columns.filter(c => c.kind === 'person');
  const people = new Map();
  const names = [];
  const seniorNames = [];

  for (const c of personCols) {
    const { name, np } = cleanMareebaName(c.header);
    if (!name) continue;
    names.push(name);
    if (c.section === 'consultant') seniorNames.push(name);
    people.set(name, {
      rawLabel: name,
      section: c.section,
      days: shown.map(d => {
        const raw = text(rows[d.row][c.col]);
        return { date: d.date, rawShift: raw, resolvedShift: resolveMareebaCell(raw, c.section, np) };
      }),
    });
  }

  // Back-ups: each day's name goes on that person's day as on call; a
  // name that could be more than one person stays as its own entry, to map.
  for (const c of columns.filter(x => x.kind === 'backup')) {
    shown.forEach((d, i) => {
      const raw = text(rows[d.row][c.col]);
      // A note in the column ("Bypass 1700", a date range) isn't a name.
      if (!raw || /\d/.test(raw)) return;
      // Back-ups are senior: matched among the SMO half.
      const full = resolveBackupName(raw, seniorNames);
      const label = full || text(raw).replace(/\([^)]*\)/g, ' ').replace(/\bfrom\b.*$/i, '').replace(/\s+/g, ' ').trim();
      if (!people.has(label)) {
        people.set(label, { rawLabel: label, section: 'consultant', days: shown.map(x => ({ date: x.date, rawShift: '', resolvedShift: null })) });
      }
      const day = people.get(label).days[i];
      day.onCallDuties = [...(day.onCallDuties || []), c.label];
    });
  }

  // Gaps and visiting sessions: an unnamed entry per column.
  const extras = [];
  for (const c of columns.filter(x => x.kind === 'gap' || x.kind === 'visiting')) {
    const entry = {
      rawLabel: c.header,
      section: c.kind === 'visiting' ? 'visiting' : c.section,
      unnamed: true,
      days: shown.map(d => {
        const raw = text(rows[d.row][c.col]);
        if (!raw) return { date: d.date, rawShift: '', resolvedShift: null };
        if (c.kind === 'visiting') {
          const place = placeFor(raw) || 'Theatre';
          return { date: d.date, rawShift: raw, resolvedShift: { segments: [{ location: place, activity: VISITING_ACTIVITY, ...MAREEBA_SHIFTS.smoDay }] } };
        }
        return { date: d.date, rawShift: raw, resolvedShift: resolveMareebaCell(raw, c.section) };
      }),
    };
    if (entry.days.some(d => d.resolvedShift?.segments)) extras.push(entry);
  }

  return [...people.values(), ...extras];
}

// Everyone named across the sheet, for Check for Missing Staff: [{ rawLabel,
// name, section, rank, fte }]. Locums and casuals are FTE 0.
export function getMareebaStaffRoster(workbook, sheetName) {
  const { columns } = readLayout(workbook, sheetName || workbook.SheetNames[0]);
  return columns.filter(c => c.kind === 'person').map(c => {
    const { name, locum, casual, np } = cleanMareebaName(c.header);
    const n = parseFloat(c.fte);
    const fte = locum || casual || /casual/i.test(c.fte) ? 0 : Number.isFinite(n) ? n : 1;
    const rank = np ? 'Nurse Practitioner' : c.section === 'rmo' ? 'PHO' : 'SMO';
    return { rawLabel: name, name, section: c.section, rank, fte };
  }).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name));
}
