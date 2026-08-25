import * as XLSX from 'xlsx';

// ============================================================
// ROSTER EXCEL EXPORT
// ============================================================
//
// The reverse of rosterExcelImport.js: turns the per-person-per-day shape
// supabaseClient.js's fetchRosterExportWeek reads out of Supabase into a
// downloadable .xlsx, one sheet per selected week. A plain, readable
// recreation of the source file's sections/rows/columns — not an attempt
// to match its colours/borders/merged cells, and not an attempt to
// reconstruct its terse shorthand codes (ED, OT, AL...), since several of
// those collapse more than one real activity onto the same abbreviation
// and there's no single correct way back. See fetchRosterExportWeek's own
// comment for the reasoning.

function formatSegment(seg) {
  return `${seg.location} / ${seg.activity} ${seg.start}-${seg.end}`;
}

function formatDayCell(day) {
  if (day.leaveCode) return day.leaveCode;
  if (!day.segments || day.segments.length === 0) return '';
  return day.segments.map(formatSegment).join(' + ');
}

function formatDutyCell(day) {
  return (day.dutyLabels || []).join(' + ');
}

function personRow(person) {
  return [person.name, ...person.days.map(formatDayCell)];
}

function sectionRows(title, people, dateLabels, { withCallObligation = false } = {}) {
  const rows = [[title], ['Name', ...dateLabels]];
  for (const person of people) {
    rows.push(personRow(person));
    if (withCallObligation) {
      rows.push(['Call Obligation', ...person.days.map(formatDutyCell)]);
    }
  }
  if (people.length === 0) rows.push(['(none)']);
  rows.push([]);
  return rows;
}

// weekData: one entry of fetchRosterExportWeek's { data } per selected week.
function buildWeekSheet(weekData) {
  const rows = [
    [`Roster: ${weekData.weekStart} - ${weekData.weekEnd}`],
    [],
    ...sectionRows('SMO / Consultant', weekData.consultants, weekData.dateLabels, { withCallObligation: true }),
    ...sectionRows('Registrar / RMO', weekData.rmo, weekData.dateLabels),
    ...sectionRows('Intern', weekData.interns, weekData.dateLabels),
  ];
  return XLSX.utils.aoa_to_sheet(rows);
}

// Sheet names: 31-char limit, no : \ / ? * [ ] — a date-based name never
// hits either.
function sheetNameFor(weekData) {
  return `Wk ${weekData.weekStart.replace(/\//g, '-')}`;
}

// weeksData: array of fetchRosterExportWeek's { data }, one per selected
// week, in order. Returns an XLSX workbook ready for XLSX.writeFile.
export function generateRosterWorkbook(weeksData) {
  const workbook = XLSX.utils.book_new();
  for (const weekData of weeksData) {
    const sheet = buildWeekSheet(weekData);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetNameFor(weekData));
  }
  return workbook;
}
