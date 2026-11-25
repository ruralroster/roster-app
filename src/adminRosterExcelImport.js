import * as XLSX from 'xlsx';

// ============================================================
// ADMIN ROSTER EXCEL IMPORT (administration officers)
// ============================================================
//
// A seventh layout (see rosterExcelImport.js's header for why each layout
// gets its own module): the administration roster, confirmed 2026-11-25
// against its workbook (one tab per pay fortnight since 22.07.24).
//
//   - One tab per fortnight, named by its Monday ("23.11.26"); many also
//     have an "Actual 23.11.26" tab: what was really worked. Both can be
//     imported; for all fortnights at once, the Actual one wins.
//   - Row 2 is "Mon … Sun Mon … Sun" in columns B-O, row 3 the dates (both
//     weeks side by side, one name column).
//   - Each person is three rows, the third "Work Area" in column A:
//       name + payroll number | that day's hours ("0800-1606")
//       (blank)               | paid hours ("7.6")
//       Work Area             | the code: RCP, PTS, REV, ED PM, WKD AM,
//                               TL, CLIN/ROI, REC LEAVE, N/A…
//     A trailing "*" or "#" on a code is a note and is ignored. A code with
//     "/" ("ROI/SC") is the first part's place.
//   - Hours are kept exactly: the roster's own handful of shifts.
//   - Full time is 76 hours a fortnight (38 a week), the sheet's FTE key;
//     the department's full_time_hours_per_week says so.
//
// Output matches the other parsers', so it flows through importRosterWeek.

export const ADMIN_ACTIVITY = 'Admin Cover';
const FORTNIGHT_TAB_RE = /^\s*(actual\s+)?(\d{2})\.(\d{2})\.(\d{2})\s*$/i;
const TIME_RE = /^(\d{1,2})[:.]?(\d{2})\s*-\s*(\d{1,2})[:.]?(\d{2})$/;
const DAYS = 14;

const text = (v) => (v ?? '').toString().replace(/\s+/g, ' ').trim();

// Work code -> where (its location). Anything else comes back unmapped.
const PLACES = {
  RCP: 'RCP', RCP2: 'RCP', PTS: 'PTS', PTS2: 'PTS', REV: 'REV',
  ED: 'ED', 'ED AM': 'ED', 'ED PM': 'ED', TL: 'TL',
  WKD: 'WKD', 'WKD AM': 'WKD', 'WKD PM': 'WKD',
  ADMIN: 'ADMIN', CLINICS: 'CLINICS', CLIN: 'CLINICS', 'CLIN/ROI': 'CLINICS', ROI: 'ROI',
  WC: 'WC', 'W/C': 'WC', JUMBUN: 'JUMBUN', 'TH/RC': 'TH/RC',
  TRAINING: 'TRAINING', MAYBO: 'TRAINING', IEMR: 'TRAINING',
};

// Leave and not-available codes -> leave_types.code, or null for N/A.
const LEAVE = [
  [/^(rec leave|rec)$/, 'AL'],
  [/^leave$/, 'AL'],
  [/^lsl$/, 'LSL'],
  [/^mat lve$/, 'ML'],
  [/^(sick|sl|s\/l)$/, 'SL'],
  [/^(c\/l)$/, 'CL'],
  [/^(phsd lve|stddown|stdown|ph)$/, 'PHSD'],
  [/^lwop$/, 'LWOP'],
  [/^(repro lve|repo leav|repo lve|rp lve)$/, 'RPL'],
  [/^(saras lve)$/, 'SARAS'],
  [/^(con|consessional|conc lve|con leave|con\/l)$/, 'CON'],
];

export function resolveAdminDay(hours, area) {
  const code = text(area).replace(/[*#]+$/, '').trim();
  const lower = code.toLowerCase();
  if (!code && !text(hours)) return null;
  if (/^(n\/a|na)$/.test(lower)) return { availability: false };
  const leave = LEAVE.find(([re]) => re.test(lower));
  if (leave) return { leaveCode: leave[1] };
  const m = text(hours).match(TIME_RE);
  if (!m) return code ? { unmapped: code } : { unmapped: text(hours) };
  if (!code) return { unmapped: 'No work area' };
  const parts = code.toUpperCase().split('/');
  const place = PLACES[code.toUpperCase()] || PLACES[parts.slice(0, 2).join('/')] || PLACES[parts[0]];
  if (!place) return { unmapped: code };
  return { segments: [{ location: place, activity: ADMIN_ACTIVITY, start: `${m[1].padStart(2, '0')}:${m[2]}`, end: `${m[3].padStart(2, '0')}:${m[4]}` }] };
}

export function parseAdminName(raw) {
  const t = text(raw);
  const m = t.match(/^(.*?)\s+(\d{5,})$/);
  return m ? { name: m[1].trim(), payroll: m[2] } : { name: t, payroll: null };
}

// The fortnight tabs: [{ sheetName, monday, actual }], oldest first.
export function getAdminSheets(workbook) {
  return workbook.SheetNames.map(sheetName => {
    const m = sheetName.match(FORTNIGHT_TAB_RE);
    return m ? { sheetName, monday: `20${m[4]}-${m[3]}-${m[2]}`, actual: !!m[1] } : null;
  }).filter(Boolean).sort((a, b) => a.monday.localeCompare(b.monday) || Number(a.actual) - Number(b.actual));
}

function excelDate(value) {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
  }
  const m = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // m/d/yy
  if (!m) return '';
  return `${m[2].padStart(2, '0')}/${m[1].padStart(2, '0')}/${m[3].length === 2 ? `20${m[3]}` : m[3]}`;
}

function readTab(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const head = rows.findIndex(r => text(r[1]) === 'Mon' && text(r[8]) === 'Mon');
  if (head < 0) throw new Error(`"${sheetName}": no Mon … Sun row`);
  const dates = Array.from({ length: DAYS }, (_, i) => excelDate(rawRows[head + 1]?.[1 + i]));
  const blocks = [];
  for (let r = head + 4; r < rows.length; r++) {
    if (text(rows[r][0]).toLowerCase() === 'work area') blocks.push({ nameRow: rows[r - 2], areaRow: rows[r] });
  }
  return { dates, blocks };
}

// Picker ranges: the fortnight, then each week.
export function getAdminWeekRanges(workbook, sheetName) {
  const { dates } = readTab(workbook, sheetName);
  return [
    { start: dates[0], end: dates[13], label: `Whole fortnight (${dates[0]}–${dates[13]})`, from: 0, count: 14 },
    { start: dates[0], end: dates[6], label: `Week 1 (${dates[0]}–${dates[6]})`, from: 0, count: 7 },
    { start: dates[7], end: dates[13], label: `Week 2 (${dates[7]}–${dates[13]})`, from: 7, count: 7 },
  ];
}

export function parseAdminRange(workbook, sheetName, rangeIndex = 0) {
  const { dates, blocks } = readTab(workbook, sheetName);
  const range = getAdminWeekRanges(workbook, sheetName)[rangeIndex] || getAdminWeekRanges(workbook, sheetName)[0];
  const people = [];
  for (const b of blocks) {
    const { name, payroll } = parseAdminName(b.nameRow?.[0]);
    if (!name) continue;
    people.push({
      rawLabel: name,
      payroll,
      section: 'admin',
      days: Array.from({ length: range.count }, (_, i) => {
        const c = 1 + range.from + i;
        const hours = text(b.nameRow?.[c]);
        const area = text(b.areaRow?.[c]);
        return { date: dates[range.from + i], rawShift: area || hours, resolvedShift: resolveAdminDay(hours, area) };
      }),
    });
  }
  return people;
}

// The latest tabs that have started, one per fortnight, Actual first: for
// importing the history in one go.
export function adminHistoryTabs(workbook, today = new Date()) {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const byMonday = new Map();
  for (const t of getAdminSheets(workbook)) {
    if (t.monday > todayStr) continue;
    const prev = byMonday.get(t.monday);
    if (!prev || t.actual) byMonday.set(t.monday, t);
  }
  return [...byMonday.values()].map(t => t.sheetName);
}

// Everyone on the three latest fortnights that have started, with FTE from
// their hours (76 a fortnight is 1.0) and payroll number.
export function getAdminStaffRoster(workbook, today = new Date()) {
  const tabs = adminHistoryTabs(workbook, today).slice(-3);
  const byName = new Map();
  for (const tab of tabs) {
    for (const p of parseAdminRange(workbook, tab, 0)) {
      // Hours worked plus leave (7.6 a day) over the fortnight.
      const worked = p.days.reduce((t, d) => {
        const s = d.resolvedShift?.segments?.[0];
        if (!s && !d.resolvedShift?.leaveCode) return t;
        if (d.resolvedShift?.leaveCode) return t + 7.6;
        const [sh, sm] = s.start.split(':').map(Number);
        const [eh, em] = s.end.split(':').map(Number);
        return t + Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
      }, 0);
      const prev = byName.get(p.rawLabel) || { hours: [], payroll: p.payroll };
      prev.hours.push(worked);
      prev.payroll = prev.payroll || p.payroll;
      byName.set(p.rawLabel, prev);
    }
  }
  return [...byName.entries()].map(([name, v]) => {
    const most = Math.max(...v.hours);
    return { rawLabel: name, name, payroll: v.payroll, fte: Math.min(1, Math.round((most / 76) * 10) / 10) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
