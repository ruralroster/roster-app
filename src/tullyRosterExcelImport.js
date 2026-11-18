import * as XLSX from 'xlsx';

// ============================================================
// TULLY ROSTER EXCEL IMPORT
// ============================================================
//
// A fourth layout alongside rosterExcelImport.js (classic),
// edRosterExcelImport.js (ED shift codes) and shiftListRosterExcelImport.js
// (Atherton) — see rosterExcelImport.js's header for why each layout gets
// its own module. This one is Tully Hospital's Medical Officer Roster,
// confirmed 2026-11-18 against the whole 2026 workbook:
//
//   - One tab per pay fortnight, named by its Monday ("09.11.26", "T5
//     26.10.26" at the start of a term). Other tabs ("Dates and Requests",
//     "blank") have no dated fortnight and are left out.
//   - Sections start at a title row in column A: "Senior Medical Officers
//     Tully Hospital" or "Resident Medical Officers Tully Hospital". Since
//     12.10.26 the SMO section appears twice on a tab; the LAST one is the
//     current roster (confirmed with the department), the earlier one an
//     old copy.
//   - Below each title: a "Mon … Sun" row, then the dates (Excel dates)
//     for week 1 in columns B–H and week 2 in J–P. Column A holds week 1's
//     names and column I week 2's, so a locum can change mid-fortnight.
//   - Each person is three rows, the third always "Work Area" in column A:
//       name + payroll number ("Jane Citizen 123456") | that day's hours ("0800-1700")
//       (blank)                                     | SMO: "SBOC" (senior back-up
//                                                     on call, 17:00–08:00) or "N/A";
//                                                     RMO: paid hours, or "N/A"
//       Work Area                                   | ED, Ward, Ward/ED, GP, CST, A/L…
//     The SMO Work Area row also carries the fortnight's shift count in
//     column S (10 = full time).
//   - "Locum Needed" / "NO RMO" are unfilled shifts, imported as empty
//     cards (unnamed) so they show as gaps.
//   - Every shift goes on the nearest of Tully's seven standard shifts
//     (TULLY_SHIFTS) for its rank, weekday or weekend and time of day,
//     not the exact hours on the sheet.
//   - A leave code in the Work Area wins over the hours above it (hours
//     over "A/L" are the leave day's). "stddown" is rostered leave on a
//     public holiday (reduced staffing); CST is admin time.
//
// Anything not known comes back `unmapped` for the import tab's Map…
// button, never guessed at. A saved code mapping for a work area keeps the
// day's own hours from the sheet (applyTullyMappings).
//
// Output matches the other parsers' { rawLabel, days: [{ date, rawShift,
// resolvedShift, onCallDuties }] }, so it flows through the same
// importRosterWeek. Dates are "DD/MM/YYYY", which importRosterWeek reads.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_FIRST_COL = [1, 9]; // B and J
const WEEK_NAME_COL = [0, 8]; // A and I
const SHIFT_COUNT_COL = 18; // S, on the SMO Work Area row
const SMO_SHIFTS_FULL_TIME = 10;

// The SBOC on-call slot's label in Settings → Duty Types (set up with the
// department, 17:00–08:00).
export const SBOC_DUTY_LABEL = 'Senior Back-up On Call (SBOC)';

// A clinical area's activity is the grade's ("SMO Cover" / "RMO Cover"),
// so SMO and RMO shifts in the same place are separate jobs and separate
// fairness records; non-clinical time has its own activities.
export const SMO_ACTIVITY = 'SMO Cover';
export const RMO_ACTIVITY = 'RMO Cover';
const at = (location, activity = null) => ({ location, activity });
const ED = at('Emergency Department');
const WARD = at('Ward');
const WARD_ED = at('Ward & ED');
const WARD_ED_GP = at('Ward, ED & GP');
const GP = at('GP Clinic');
const JUMBUN = at('Jumbun Clinic');
const NON_CLINICAL = 'Non-clinical';

// Tully's standard shifts (confirmed 2026-11-19: fewer shifts, everyone on
// the nearest one, rather than every variation on the sheet). By rank,
// weekday or weekend, and time of day; set up as named shifts by
// migrations/2026-11-19_tully_shifts.sql.
export const TULLY_SHIFTS = {
  smoDay: { name: 'Weekday Day SMO', start: '08:00', end: '17:00' },
  smoLate: { name: 'Weekday Late SMO', start: '12:00', end: '22:00' },
  smoWeekend: { name: 'Weekend SMO', start: '08:00', end: '18:00' },
  rmoDay: { name: 'Weekday Day RMO', start: '08:00', end: '16:30' },
  rmoEd: { name: 'Weekday ED RMO', start: '10:00', end: '21:30' },
  rmoWeekend: { name: 'Weekend RMO', start: '10:30', end: '22:00' },
  rmoNight: { name: 'Night RMO', start: '21:00', end: '08:30' },
};

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// The standard shift for a shift on the sheet. weekend: Saturday or
// Sunday. Nights start from 19:00; an SMO's late or an RMO's ED shift
// starts from 10:00 on a weekday.
export function standardTullyShift(section, weekend, { start }) {
  const s = minutes(start);
  if (section === 'rmo') {
    if (s >= 19 * 60) return TULLY_SHIFTS.rmoNight;
    if (weekend) return TULLY_SHIFTS.rmoWeekend;
    return s >= 10 * 60 ? TULLY_SHIFTS.rmoEd : TULLY_SHIFTS.rmoDay;
  }
  if (weekend) return TULLY_SHIFTS.smoWeekend;
  return s >= 10 * 60 ? TULLY_SHIFTS.smoLate : TULLY_SHIFTS.smoDay;
}

const isWeekendDate = (ddmmyyyy) => {
  const [d, m, y] = (ddmmyyyy || '').split('/').map(Number);
  if (!d) return false;
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
};

// A day's segments put on their standard shift's hours.
function onStandardShift(resolvedShift, section, date) {
  if (!resolvedShift?.segments) return resolvedShift;
  return {
    ...resolvedShift,
    segments: resolvedShift.segments.map(seg => {
      const std = standardTullyShift(section, isWeekendDate(date), seg);
      return { ...seg, start: std.start, end: std.end, sheetHours: `${seg.start}–${seg.end}` };
    }),
  };
}

// Work Area text (lower case, spaces tidied) -> where the day is spent.
const AREA_MAP = {
  ed: ED,
  ward: WARD,
  'ward/ed': WARD_ED,
  'ed/ward': WARD_ED,
  'ward/ed/gp': WARD_ED_GP,
  gp: GP,
  jumbun: JUMBUN,
  cst: at(NON_CLINICAL, 'Admin Time'),
  admin: at(NON_CLINICAL, 'Admin Time'),
  orientation: at(NON_CLINICAL, 'Orientation'),
  travel: at(NON_CLINICAL, 'Travel'),
  meeting: at(NON_CLINICAL, 'Meeting'),
  'cmo meeting': at(NON_CLINICAL, 'Meeting'),
  'rrs meeting': at(NON_CLINICAL, 'Meeting'),
  workshop: at(NON_CLINICAL, 'Meeting'),
};

// Leave, by Work Area (or a note under the hours) -> leave_types.code.
const LEAVE_MAP = {
  'a/l': 'AL',
  al: 'AL',
  leave: 'AL',
  pdl: 'PDL',
  lwop: 'LWOP',
  sick: 'SL',
  "carer's leave": 'CL',
  'carers leave': 'CL',
  stddown: 'PHSD',
};

const TIME_RE = /^(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})$/;
const NOT_AVAILABLE_RE = /^n\/a\b/i;
const PLACEHOLDER_RE = /^(locum needed|locum required|no rmo|no smo|vacant|tba|tbc|locum)$/i;
const TITLE_RE = /^(senior|resident) medical officers/i;
const FORTNIGHT_TAB_RE = /(\d{2})\.(\d{2})\.(\d{2})\s*$/;

const key = (text) => (text || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
const cell = (row, c) => (row?.[c] ?? '').toString().trim();

export function parseTime(text) {
  const m = (text || '').toString().trim().match(TIME_RE);
  if (!m) return null;
  return { start: `${m[1]}:${m[2]}`, end: `${m[3]}:${m[4]}` };
}

// "Jane Citizen 123456" -> { name, payroll }. A placeholder ("Locum
// Needed") or a blank comes back with no name.
export function parseTullyName(text) {
  const raw = (text || '').toString().replace(/\s+/g, ' ').trim();
  if (!raw || PLACEHOLDER_RE.test(raw)) return { name: '', payroll: null, placeholder: !!raw };
  const m = raw.match(/^(.*?)\s+(\d{5,})$/);
  return m ? { name: m[1].trim(), payroll: m[2] } : { name: raw, payroll: null };
}

function excelDate(value) {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
  }
  const text = (value ?? '').toString().trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // the sheet's m/d/yy text
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${m[2].padStart(2, '0')}/${m[1].padStart(2, '0')}/${y}`;
}

// The fortnight tabs, in workbook order: [{ sheetName, monday }] with
// monday as YYYY-MM-DD from the tab's name.
export function getTullySheets(workbook) {
  return workbook.SheetNames.map(sheetName => {
    const m = sheetName.match(FORTNIGHT_TAB_RE);
    return m ? { sheetName, monday: `20${m[3]}-${m[2]}-${m[1]}` } : null;
  }).filter(Boolean);
}

// One day -> what importRosterWeek reads. hours: the time row's text;
// note: the row under it; area: the Work Area.
export function resolveTullyDay(hours, note, area, section = 'consultant') {
  const areaKey = key(area);
  const noteKey = key(note);
  const time = parseTime(hours);
  if (LEAVE_MAP[areaKey]) return { leaveCode: LEAVE_MAP[areaKey] };
  if (LEAVE_MAP[noteKey]) return { leaveCode: LEAVE_MAP[noteKey] };
  if (!time && LEAVE_MAP[key(hours)]) return { leaveCode: LEAVE_MAP[key(hours)] };
  if (time) {
    if (!areaKey) return { unmapped: 'No work area' };
    const where = AREA_MAP[areaKey];
    if (!where) return { unmapped: area.toString().replace(/\s+/g, ' ').trim() };
    const activity = where.activity || (section === 'rmo' ? RMO_ACTIVITY : SMO_ACTIVITY);
    return { segments: [{ location: where.location, activity, start: time.start, end: time.end }] };
  }
  if (NOT_AVAILABLE_RE.test(noteKey)) return { availability: false };
  if (hours) return { unmapped: hours.toString().trim() };
  return null;
}

// Every section of one tab, with the earlier copies of a repeated section
// dropped: [{ section: 'consultant' | 'rmo', titleRow, endRow }].
// A title only starts a section with its "Mon … Sun" row just below: one
// pasted over a Work Area cell (02.02.26) is that person's Work Area row.
const startsSection = (rows, r) => [1, 2, 3].some(n => key(cell(rows[r + n], 1)) === 'mon');

function sectionsOf(rows) {
  const titles = [];
  rows.forEach((row, r) => {
    const m = cell(row, 0).match(TITLE_RE);
    if (m && startsSection(rows, r)) titles.push({ section: m[1].toLowerCase() === 'senior' ? 'consultant' : 'rmo', titleRow: r });
  });
  const withEnds = titles.map((t, i) => ({ ...t, endRow: i + 1 < titles.length ? titles[i + 1].titleRow : rows.length }));
  return withEnds.filter((t, i) => !withEnds.slice(i + 1).some(later => later.section === t.section));
}

function readSheet(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  return {
    rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }),
    rawRows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }),
  };
}

// Each person block in a section: { nameRow, noteRow, areaRow }.
function blocksOf(rows, { titleRow, endRow }) {
  const blocks = [];
  for (let r = titleRow + 1; r < endRow; r++) {
    const label = cell(rows[r], 0);
    const isAreaRow = key(label) === 'work area' || (TITLE_RE.test(label) && !startsSection(rows, r));
    if (isAreaRow && r >= titleRow + 3) {
      blocks.push({ nameRow: rows[r - 2] || [], noteRow: rows[r - 1] || [], areaRow: rows[r] || [] });
    }
  }
  return blocks;
}

// The dates of both weeks, from the section's own date row (the row after
// its "Mon … Sun" row).
function datesOf(rows, rawRows, { titleRow, endRow }) {
  for (let r = titleRow; r < Math.min(endRow, titleRow + 4); r++) {
    if (key(cell(rows[r], 1)) === 'mon' && key(cell(rows[r], 9)) === 'mon') {
      const dateRow = rawRows[r + 1] || [];
      return WEEK_FIRST_COL.map(first => DAY_LABELS.map((_, i) => excelDate(dateRow[first + i])));
    }
  }
  return [[], []];
}

// Picker ranges for one tab: the whole fortnight, then each week.
export function getTullyWeekRanges(workbook, sheetName) {
  const { rows, rawRows } = readSheet(workbook, sheetName);
  const [first] = sectionsOf(rows);
  if (!first) return [];
  const [w1, w2] = datesOf(rows, rawRows, first);
  if (!w1[0] || !w2[6]) return [];
  return [
    { start: w1[0], end: w2[6], label: `Whole fortnight (${w1[0]}–${w2[6]})` },
    { start: w1[0], end: w1[6], label: `Week 1 (${w1[0]}–${w1[6]})` },
    { start: w2[0], end: w2[6], label: `Week 2 (${w2[0]}–${w2[6]})` },
  ];
}

// One person-week of a block -> { rawLabel, section, fte, payroll,
// unnamed, days }.
function personWeek(block, week, dates, section) {
  const first = WEEK_FIRST_COL[week];
  const { name, payroll, placeholder } = parseTullyName(cell(block.nameRow, WEEK_NAME_COL[week]));
  const days = DAY_LABELS.map((label, i) => {
    const hours = cell(block.nameRow, first + i);
    const note = cell(block.noteRow, first + i);
    const area = cell(block.areaRow, first + i);
    const resolvedShift = onStandardShift(resolveTullyDay(hours, note, area, section), section, dates[i]);
    const time = parseTime(hours);
    return {
      label,
      date: dates[i] || '',
      rawShift: area || hours,
      resolvedShift,
      hours: time,
      ...(section === 'consultant' && key(note) === 'sboc' ? { onCallDuties: [SBOC_DUTY_LABEL] } : {}),
    };
  });
  const shiftCount = parseFloat(cell(block.areaRow, SHIFT_COUNT_COL));
  const fte = section === 'consultant'
    ? (Number.isFinite(shiftCount) ? Math.round((shiftCount / SMO_SHIFTS_FULL_TIME) * 100) / 100 : null)
    : 1;
  return { rawLabel: name || (placeholder ? cell(block.nameRow, WEEK_NAME_COL[week]) : ''), name, payroll, section, fte, unnamed: !name, days };
}

// One tab, one range (getTullyWeekRanges index: 0 the whole fortnight, 1
// week 1, 2 week 2) -> importRosterWeek's people. An unnamed row with
// nothing on it is left out; one with shifts ("Locum Needed") stays as
// unnamed, for the unfilled-card option.
export function parseTullyRange(workbook, sheetName, rangeIndex = 0) {
  const { rows, rawRows } = readSheet(workbook, sheetName);
  const weeks = rangeIndex === 1 ? [0] : rangeIndex === 2 ? [1] : [0, 1];
  const people = [];
  for (const sec of sectionsOf(rows)) {
    const dates = datesOf(rows, rawRows, sec);
    for (const block of blocksOf(rows, sec)) {
      for (const week of weeks) {
        const p = personWeek(block, week, dates[week], sec.section);
        const hasAnything = p.days.some(d => d.resolvedShift || d.onCallDuties);
        if (p.unnamed && !p.days.some(d => d.resolvedShift?.segments)) continue;
        if (!p.unnamed || hasAnything) people.push(p);
      }
    }
  }
  // The same person in both weeks becomes one entry with all 14 days, so
  // the results read per person, not per week.
  const merged = [];
  for (const p of people) {
    const same = !p.unnamed && merged.find(m => !m.unnamed && m.section === p.section && key(m.rawLabel) === key(p.rawLabel));
    if (same) same.days.push(...p.days);
    else merged.push({ ...p, days: [...p.days] });
  }
  return merged;
}

// Saved Map… fixes: a work area mapped to a location and activity keeps
// the day's own hours from the sheet; one mapped to leave is that leave.
export function applyTullyMappings(people, codeMap) {
  return people.map(person => ({
    ...person,
    days: person.days.map(day => {
      const code = day.resolvedShift?.unmapped;
      const mapped = code && (codeMap[code] || codeMap[code.replace(/\s+/g, ' ')]);
      if (!mapped) return day;
      if (mapped.leaveCode) return { ...day, resolvedShift: { leaveCode: mapped.leaveCode } };
      const seg = mapped.segments?.[0];
      if (!seg) return day;
      const hours = day.hours || { start: seg.start, end: seg.end };
      const resolved = { segments: [{ location: seg.location, activity: seg.activity, start: hours.start, end: hours.end }] };
      return { ...day, resolvedShift: onStandardShift(resolved, person.section, day.date) };
    }),
  }));
}

// Everyone named on the given tabs (default: the three latest fortnights
// that have started by `today`), for Check for Missing Staff: [{ rawLabel,
// name, payroll, section, fte }], latest sighting's FTE winning.
export function getTullyStaffRoster(workbook, sheetNames = null, today = new Date()) {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tabs = sheetNames || getTullySheets(workbook).filter(t => t.monday <= todayStr).slice(-3).map(t => t.sheetName);
  const byName = new Map();
  for (const sheetName of tabs) {
    for (const p of parseTullyRange(workbook, sheetName, 0)) {
      if (p.unnamed || !p.name) continue;
      const k = key(p.name);
      const prev = byName.get(k);
      byName.set(k, { rawLabel: p.name, name: p.name, payroll: p.payroll || prev?.payroll || null, section: p.section, fte: p.fte ?? prev?.fte ?? null });
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function tullyStaffTabs(workbook, today = new Date()) {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return getTullySheets(workbook).filter(t => t.monday <= todayStr).slice(-3).map(t => t.sheetName);
}
