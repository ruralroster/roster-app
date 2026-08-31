import * as XLSX from 'xlsx';

// ============================================================
// ED ROSTER EXCEL IMPORT
// ============================================================
//
// A second, differently-shaped parser alongside rosterExcelImport.js — see
// that file's own header for why a new department gets its own module
// rather than a shared "one parser fits all layouts" attempt: every
// department's roster is a hand-built spreadsheet with no common schema.
// This one covers the Emergency Department's layout, confirmed against
// exelRosters/CBH/Emergency/Sample roster for Ben.xlsx (2026-08-31):
//
//   - Each workbook tab (not each week-block within one sheet, unlike the
//     other department) covers 4 consecutive weeks: dates on row 4
//     (0-indexed row 3), Monday-start columns at B/I/P/W (0-indexed 1/8/15/22).
//   - Column A is the person's name, with FTE or casual status baked
//     right into the label: "JEFFARES Lynne (0.5 FTE)", "RIDOLFI Pietro
//     (Casual)" — read directly rather than asked for separately.
//   - Section-header rows (TS4, TS1 - 3, ACRRM / CICM / RACGP, PHO, GP,
//     LOCUMS) carry no shift data — detected generically as "non-blank
//     column A, but every one of the 28 date columns is blank" rather than
//     matched against a fixed list of header text, so a renamed or added
//     section doesn't silently break parsing.
//   - A "COUNT" row starts the tally/validation footer below the roster
//     data (per-shift-code weekly counts, the shift/letter decode key,
//     FTE/Fortnight totals) — everything from there down is excluded.
//   - Shift codes are <start time><team letter>, e.g. "0730B" (Day shift,
//     Acute Team B), "2200A" (Night, Acute Team A), "1300ST" (Evening, A
//     STAR). Confirmed against the sheet's own rows 118-120 (start/end/
//     rest by start time) and 121-126 (letter -> team). Activity is always
//     "Emergency" except the "T" (teaching) suffix, which is its own
//     "Teaching" location/activity — confirmed 2026-08-31: T doesn't
//     affect shift length, and unlike every other letter it never appears
//     combined with a team letter, so it gets its own location rather than
//     guessing which team a teaching session would otherwise have covered.
//   - PDL/AL are already-standard leave codes; MED ED/BL/EXAM are
//     department-specific leave types the officer creates in Settings —
//     confirmed codes: MED ED -> "MDED", BL -> "BL", EXAM -> "EXAM".
//
// Output shape matches rosterExcelImport.js exactly — { rawLabel, days: [
// { date, rawShift, resolvedShift } ] } — so it flows through the same
// generic importRosterWeek in supabaseClient.js unchanged.

export const DATE_ROW_INDEX = 3; // 0-indexed row 4
export const WEEK_MONDAY_COLS = [1, 8, 15, 22]; // 0-indexed columns B, I, P, W
const DATA_START_ROW = 5; // 0-indexed row 6 — the first section header ("TS4")
const COUNT_SENTINEL = 'COUNT';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const BARE_LEAVE_MAP = {
  PDL: 'PDL',
  AL: 'AL',
  'MED ED': 'MDED',
  BL: 'BL',
  EXAM: 'EXAM',
};

// Start (Day/Evening/Night), end, per the sheet's own rows 118-120. The
// 30-minute unpaid rest each carries isn't tracked anywhere in this app's
// shift model (confirmed 2026-08-31 that this doesn't matter for now).
const SHIFT_TIME_MAP = {
  '0730': { start: '07:30', end: '17:30' },
  '1300': { start: '13:00', end: '23:00' },
  '2200': { start: '22:00', end: '08:00' },
};

// Letter -> team, per the sheet's own rows 121-126, plus "T" (Teaching)
// confirmed separately since it isn't in that decode table.
const LETTER_LOCATION_MAP = {
  A: 'Acute Team A',
  B: 'Acute Team B',
  C: 'Paediatrics',
  D: 'Fast Track',
  E: 'STTA',
  ST: 'A STAR',
  T: 'Teaching',
};

const SHIFT_CODE_RE = /^(\d{4})([A-Za-z]+)$/;

// Confirmed 2026-08-31: ACRRM/CICM/RACGP, GP, TS1-3, and PHO are all
// non-ACEM-training-program people getting their required ED time in —
// treated as one rank in this department. TS4 and Locums stand alone.
// Keys are the section-header text with internal whitespace collapsed —
// matching is whitespace-insensitive since the sheet isn't perfectly
// consistent about spacing ("TS1 - 3" vs "ACRRM / CICM / RACGP").
const SECTION_RANK_MAP = {
  'TS4': 'TS4',
  'TS1 - 3': 'Basic Trainee (ACRRM, RACGP, CICM, GP)',
  'ACRRM / CICM / RACGP': 'Basic Trainee (ACRRM, RACGP, CICM, GP)',
  'PHO': 'Basic Trainee (ACRRM, RACGP, CICM, GP)',
  'GP': 'Basic Trainee (ACRRM, RACGP, CICM, GP)',
  'LOCUMS': 'Locums',
};

function normalizeHeaderText(raw) {
  return (raw || '').toString().replace(/\s+/g, ' ').trim();
}

// A staff label always has the real name first, optionally followed by
// "(0.5 FTE)" / "(0.75 FTE)" / "(0.25 FTE)" / "(Casual)". Casual is treated
// like a locum — 0 FTE, since neither has a standing rostered load (see
// the locum FTE=0 discussion this was built from).
const FTE_SUFFIX_RE = /\s*\(([\d.]+)\s*FTE\)\s*$/i;
const CASUAL_SUFFIX_RE = /\s*\(Casual\)\s*$/i;

function parseNameAndFte(rawCell) {
  const raw = (rawCell || '').toString().trim();
  const fteMatch = raw.match(FTE_SUFFIX_RE);
  if (fteMatch) {
    return { name: raw.replace(FTE_SUFFIX_RE, '').trim(), fte: parseFloat(fteMatch[1]) };
  }
  if (CASUAL_SUFFIX_RE.test(raw)) {
    return { name: raw.replace(CASUAL_SUFFIX_RE, '').trim(), fte: 0 };
  }
  return { name: raw, fte: 1 };
}

function sheetToRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

// Matched against the known section labels (SECTION_RANK_MAP) rather than
// "blank across every date column" — confirmed 2026-08-31 against the real
// file that at least one real person (VIRDEE Aleena) has zero shifts in
// either 4-week block shown, which a blank-based heuristic would have
// wrongly folded into the header above her, corrupting every section
// below. A label not in this known set is never guessed at as a header.
function isHeaderRow(col0) {
  return Object.prototype.hasOwnProperty.call(SECTION_RANK_MAP, normalizeHeaderText(col0));
}

function findCountRow(rows) {
  for (let r = DATA_START_ROW; r < rows.length; r++) {
    if ((rows[r][0] || '').toString().trim().toUpperCase() === COUNT_SENTINEL) return r;
  }
  return rows.length;
}

// Resolves one day's shift-cell text. Anything not recognized comes back
// tagged `unmapped` rather than guessed at — same rule as
// rosterExcelImport.js's resolveShiftCode, for the same reason: wrong
// roster data is a patient-safety issue, not a cosmetic one.
export function resolveEdShiftCode(rawCode) {
  const code = (rawCode || '').toString().trim();
  if (!code) return null;

  if (BARE_LEAVE_MAP[code]) return { leaveCode: BARE_LEAVE_MAP[code] };

  const match = code.match(SHIFT_CODE_RE);
  if (match) {
    const [, startTime, lettersRaw] = match;
    const letters = lettersRaw.toUpperCase();
    const time = SHIFT_TIME_MAP[startTime];
    const location = LETTER_LOCATION_MAP[letters];
    if (time && location) {
      const activity = letters === 'T' ? 'Teaching' : 'Emergency';
      return { segments: [{ location, activity, start: time.start, end: time.end }] };
    }
  }

  return { unmapped: code };
}

// Walks the roster-data rows of one sheet, tracking the section header
// each person falls under. Returns one row per real person (headers and
// blank rows skipped), each carrying the row index so callers can slice
// out whichever week's columns they need.
function walkEdSheetRows(rows) {
  const countRow = findCountRow(rows);
  let currentSection = null;
  const people = [];

  for (let r = DATA_START_ROW; r < countRow; r++) {
    const row = rows[r] || [];
    const col0 = (row[0] || '').toString().trim();
    if (!col0) continue;

    if (isHeaderRow(col0)) {
      currentSection = normalizeHeaderText(col0);
      continue;
    }

    const { name, fte } = parseNameAndFte(col0);
    if (!name) continue;

    people.push({
      rowIndex: r,
      rawLabel: col0,
      name,
      fte,
      section: currentSection,
      suggestedRank: SECTION_RANK_MAP[currentSection] || null,
      row,
    });
  }

  return people;
}

export function getEdSheetNames(workbook) {
  return workbook.SheetNames;
}

// The real Mon-Sun dates for each of the 4 week-blocks a sheet covers —
// lets a picker show "Week 2 (15/06-21/06)" instead of an opaque index.
export function getEdWeekDateRanges(workbook, sheetName) {
  const rows = sheetToRows(workbook, sheetName);
  return WEEK_MONDAY_COLS.map(mondayCol => ({
    start: (rows[DATE_ROW_INDEX]?.[mondayCol] || '').toString().trim(),
    end: (rows[DATE_ROW_INDEX]?.[mondayCol + 6] || '').toString().trim(),
  }));
}

// One sheet, one week-block -> the { rawLabel, days } shape importRosterWeek
// expects. Deliberately re-walks the WHOLE sheet's 28 date columns to
// decide header-vs-person (isHeaderRow), not just this week's 7 — a locum
// idle for this particular week but rostered in another one must not be
// mistaken for a section header.
export function parseEdWeek(workbook, sheetName, weekIndex) {
  const mondayCol = WEEK_MONDAY_COLS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this layout only has ${WEEK_MONDAY_COLS.length} week blocks per sheet`);
  }

  const rows = sheetToRows(workbook, sheetName);
  const dates = DAY_LABELS.map((_, i) => (rows[DATE_ROW_INDEX]?.[mondayCol + i] || '').toString().trim());
  const people = walkEdSheetRows(rows);

  return people.map(person => ({
    rawLabel: person.name,
    days: DAY_LABELS.map((label, i) => {
      const col = mondayCol + i;
      const rawShift = (person.row[col] || '').toString().trim();
      return {
        label,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveEdShiftCode(rawShift) : null,
      };
    }),
  }));
}

// Every distinct person across every sheet in the workbook, deduped by
// name (case-insensitive) — the source list for the "create missing
// staff" preview step, since a brand-new department has no staff to match
// against yet. FTE and suggested rank come from wherever the name is
// first seen; if the same person appears under two different section
// headers across sheets (shouldn't happen, but not fatal), the first
// sighting wins rather than silently overwriting.
export function getEdStaffRoster(workbook) {
  const byName = new Map();

  for (const sheetName of workbook.SheetNames) {
    const rows = sheetToRows(workbook, sheetName);
    for (const person of walkEdSheetRows(rows)) {
      const key = person.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, { name: person.name, fte: person.fte, section: person.section, suggestedRank: person.suggestedRank });
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
