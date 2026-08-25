import * as XLSX from 'xlsx';
import { SESSION_DEFAULT_TIMES } from './shiftSessionUtils';

// ============================================================
// ROSTER EXCEL IMPORT
// ============================================================
//
// Converts the department's hand-built Excel roster
// (exelRosters/*.xlsx) into the same location+activity+shift/leave/
// on-call shape the rest of the app already uses.
//
// The file has no clean tabular schema — it's a stack of manually
// laid-out sections with a different row pattern per staff group. Three
// sections are covered so far: SMO/Consultant (below), Registrar/RMO,
// and Intern (further down). Locums are deliberately skipped — the
// department confirmed that's fine — and the Standby/AF summary panel
// still needs its own investigation before it can be parsed safely (it's
// a backup-contact lookup table, not a per-person roster, so it doesn't
// fit this module's shape at all) — see the conversation history this
// was built from.
//
// The anchor: every consultant's block is the literal text
// "CALL OBLIGATION" in column A, always laid out as:
//   [contact line   ] (optional, 2 rows above the anchor)
//   [name  | that day's primary shift/leave code]  (1 row above)
//   [CALL OBLIGATION | that day's on-call note ]  <- the anchor row
//   [FTE   | that day's hours                  ]  (1 row below)
// Confirmed against the 2026-08-17 to 2026-09-13 DRAFT file: exactly 14
// "CALL OBLIGATION" rows, matching all 14 named consultants, and none
// from the Registrar/Locum/Standby sections.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Column where each week block's Monday sits, and the row its dates are
// on — specific to this file's current layout. A future export with a
// different layout would need these re-derived (see the Excel-analysis
// discussion this was built from), not guessed.
export const WEEK_BLOCK_MONDAY_COLUMNS = [1, 9, 19, 27];
export const DATE_ROW_INDEX = 4;

const AM = SESSION_DEFAULT_TIMES.AM; // 09:00–12:00
const PM = SESSION_DEFAULT_TIMES.PM; // 12:30–18:00

function clinicalSegment(location, activity, start, end) {
  return { segments: [{ location, activity, start: start || null, end: end || null }] };
}

// Confirmed with the department (2026-08-25) — see conversation history
// for the reasoning behind each mapping. Keys are matched case-sensitively
// against the trimmed cell text (or half of an "X/Y" split code).
const SINGLE_CODE_MAP = {
  'AL': { leaveCode: 'AL' },
  'S/L': { leaveCode: 'SL' }, // Study Leave, not Sick Leave
  'ED': clinicalSegment('Emergency', 'Emergency Department Cover', '08:00', '18:00'),
  'EDL + OC': clinicalSegment('Emergency', 'Emergency Department Cover', '10:30', '21:00'),
  'Ward 1': clinicalSegment('Ward 1', 'Ward Care Cover', '08:00', '18:00'),
  'Ward 2': clinicalSegment('Ward 2', 'Ward Care Cover', '08:00', '18:00'),
  'WARD (1&2)': clinicalSegment('Ward 1 and 2 (Weekend Cover)', 'Ward (1&2)', '08:00', '18:00'),
  'Maternity': clinicalSegment('Maternity', 'Ward Care Cover', '08:00', '18:00'),
  'Admin': clinicalSegment('Non-clinical', 'Admin', null, null),
  'DMS': clinicalSegment('Non-clinical', 'Admin', null, null),
  'Endo': clinicalSegment('Theatre', 'Endoscopy', null, null),
  'OT': clinicalSegment('Theatre', 'General Theatre', null, null),
  'Obs Clinic': clinicalSegment('Clinic', 'Obstetrics', null, null),
  'ANC': clinicalSegment('Clinic', 'Obstetrics', null, null),
  'ObsC': clinicalSegment('Clinic', 'Obstetrics', null, null),
  'Obs': clinicalSegment('Clinic', 'Obstetrics', null, null),
};

// Resolves one day's shift-cell text. A plain code looks itself up
// directly; an "X/Y" code splits into an AM half and a PM half at the
// confirmed session-border times (09:00–12:00 / 12:30–18:00), unless
// that half already carries its own fixed time (e.g. ED's real
// 08:00–18:00). Anything not in SINGLE_CODE_MAP comes back tagged
// `unmapped` rather than silently guessed at, so nothing goes missing
// without being visible to whoever reviews the output.
export function resolveShiftCode(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) return null;

  if (SINGLE_CODE_MAP[code]) return SINGLE_CODE_MAP[code];

  if (code.includes('/')) {
    const [amPart, pmPart] = code.split('/').map(s => s.trim());
    const amMatch = SINGLE_CODE_MAP[amPart];
    const pmMatch = SINGLE_CODE_MAP[pmPart];
    if (amMatch?.segments && pmMatch?.segments) {
      const amSeg = amMatch.segments[0];
      const pmSeg = pmMatch.segments[0];
      return {
        segments: [
          { ...amSeg, start: amSeg.start || AM.start, end: amSeg.end || AM.end },
          { ...pmSeg, start: pmSeg.start || PM.start, end: pmSeg.end || PM.end },
        ],
      };
    }
  }

  return { unmapped: code };
}

// CALL OBLIGATION column text — confirmed rule (2026-08-25):
//   "Oncall" -> this person is on-call for ED
//   "Anaes"  -> this person is on-call for Anaesthetics
//   "Obs"    -> this person is on-call for Obstetrics
// A cell can combine more than one (e.g. "Oncall + Anaes"). Plain
// "Anaes"/"Obs" alone does NOT imply ED on-call — that's covered
// separately by whoever's actually rostered on the EDL shift that day.
export function parseOnCallNote(rawNote) {
  const note = (rawNote || '').toString().trim();
  if (!note) return null;
  const lower = note.toLowerCase();
  return {
    raw: note,
    ed: lower.includes('oncall'),
    anaes: lower.includes('anaes'),
    obs: lower.includes('obs'),
  };
}

// Finds every "CALL OBLIGATION" anchor row and, for the given week's
// Monday column, extracts that consultant's name label, contact line,
// FTE, and each of the 7 days' resolved shift/leave + on-call.
export function extractConsultantWeek(rows, mondayCol) {
  const dates = DAY_LABELS.map((_, i) => (rows[DATE_ROW_INDEX]?.[mondayCol + i] || '').toString().trim());

  const anchors = [];
  rows.forEach((row, r) => {
    if ((row[0] || '').toString().trim() === 'CALL OBLIGATION') anchors.push(r);
  });

  return anchors.map(r => {
    const nameRow = rows[r - 1] || [];
    const callRow = rows[r] || [];
    const fteRow = rows[r + 1] || [];
    const contactRow = rows[r - 2] || [];

    const days = DAY_LABELS.map((label, i) => {
      const col = mondayCol + i;
      const rawShift = (nameRow[col] || '').toString().trim();
      const rawOnCall = (callRow[col] || '').toString().trim();
      return {
        label,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveShiftCode(rawShift) : null,
        rawOnCall,
        onCall: rawOnCall ? parseOnCallNote(rawOnCall) : null,
        hours: (fteRow[col] || '').toString().trim(),
      };
    });

    return {
      rawLabel: (nameRow[0] || '').toString().trim(),
      contactLine: (contactRow[mondayCol] || contactRow[0] || '').toString().trim(),
      fte: (fteRow[0] || '').toString().trim(),
      days,
    };
  });
}

// Top-level entry point — pass the parsed workbook (from XLSX.read on an
// uploaded file's ArrayBuffer) and which of the file's week blocks to
// extract (0 = first week shown, 1 = second, ...).
export function parseConsultantWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const mondayCol = WEEK_BLOCK_MONDAY_COLUMNS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this file only has ${WEEK_BLOCK_MONDAY_COLUMNS.length} week blocks`);
  }
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return extractConsultantWeek(rows, mondayCol);
}

// ============================================================
// ROSTER EXCEL IMPORT — Registrar/RMO section
// ============================================================
//
// A different row shape from the SMO/Consultant section: no CALL
// OBLIGATION/FTE rows at all, just one name row per person (column A =
// name, columns for the week = that day's shift text), with an optional
// contact line directly above when a phone number was recorded. The
// section starts at its own "Week 1"/date header pair (row 107 in the
// current DRAFT file, under the "PHO" org unit) and runs until the next
// "Week N" header (the Interns section).
//
// The shift codes here are also a different *shape* from the consultant
// section — longhand ("Day 0800 -1800 \nED") rather than terse
// abbreviations — so they get their own resolver, though "X/Y" split
// codes (e.g. "OT/ED") reuse the consultant section's map and split
// logic directly since those tokens are shared.
export const RMO_SECTION_START_ROW = 107;

const TIME_RANGE_RE = /(\d{3,4})\s*-\s*(\d{3,4})/;

function normalizeHHMM(raw) {
  const digits = raw.padStart(4, '0');
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// Confirmed with the department (2026-08-25):
//   - "Night ####-####" / "Evening ####-####" have no location suffix —
//     both are always Emergency / Emergency Department Cover.
//   - "Day ####-####" always carries an explicit location suffix after
//     the newline (e.g. "ED", "WARD 1"), resolved via this table.
const RMO_DAY_LOCATION_TOKEN_MAP = {
  'ED': { location: 'Emergency', activity: 'Emergency Department Cover' },
  'WARD 1': { location: 'Ward 1', activity: 'Ward Care Cover' },
};

// Codes with no time component at all.
const RMO_BARE_CODE_MAP = {
  'A/L': { leaveCode: 'AL' },
  'GP': { leaveCode: 'GP' },
  'Day Shift': clinicalSegment('Ward 1', 'Ward Care Cover', '08:00', '18:00'),
  'Clinic': clinicalSegment('Clinic', 'Medical Clinic', null, null),
  'Chemo': clinicalSegment('Clinic', 'Chemo', null, null),
};

export function resolveRmoShiftCode(rawCode) {
  const code = (rawCode || '').replace(/\s+/g, ' ').trim();
  if (!code) return null;

  if (RMO_BARE_CODE_MAP[code]) return RMO_BARE_CODE_MAP[code];

  // "OT/ED" and similar split codes reuse the consultant section's map
  // and AM/PM-split logic directly.
  if (code.includes('/')) {
    const viaConsultantMap = resolveShiftCode(code);
    if (!viaConsultantMap.unmapped) return viaConsultantMap;
  }

  const timeMatch = code.match(TIME_RANGE_RE);
  if (timeMatch) {
    const start = normalizeHHMM(timeMatch[1]);
    const end = normalizeHHMM(timeMatch[2]);

    if (/^Night/i.test(code) || /^Evening/i.test(code)) {
      return clinicalSegment('Emergency', 'Emergency Department Cover', start, end);
    }

    const locationToken = code.replace(TIME_RANGE_RE, '').replace(/^Day/i, '').trim().toUpperCase();
    const mapped = RMO_DAY_LOCATION_TOKEN_MAP[locationToken];
    if (mapped) return clinicalSegment(mapped.location, mapped.activity, start, end);
  }

  return { unmapped: code };
}

// Walks down from the section's date row collecting name rows — any row
// with a non-blank column A that isn't itself the next section's "Week
// N" header — until that next header is hit.
export function extractRmoWeek(rows, sectionStartRow, mondayCol) {
  const dateRowIndex = sectionStartRow + 1;
  const dates = DAY_LABELS.map((_, i) => (rows[dateRowIndex]?.[mondayCol + i] || '').toString().trim());

  const people = [];
  for (let r = sectionStartRow + 2; r < rows.length; r++) {
    const col0 = (rows[r][0] || '').toString().trim();
    if (/^Week\s+\d/i.test(col0)) break;
    if (!col0) continue;

    const contactRow = rows[r - 1] || [];
    const days = DAY_LABELS.map((label, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      return {
        label,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveRmoShiftCode(rawShift) : null,
      };
    });

    people.push({
      rawLabel: col0,
      contactLine: (contactRow[mondayCol] || contactRow[1] || '').toString().trim(),
      days,
    });
  }

  return people;
}

export function parseRmoWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const mondayCol = WEEK_BLOCK_MONDAY_COLUMNS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this file only has ${WEEK_BLOCK_MONDAY_COLUMNS.length} week blocks`);
  }
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return extractRmoWeek(rows, RMO_SECTION_START_ROW, mondayCol);
}

// ============================================================
// ROSTER EXCEL IMPORT — Intern section
// ============================================================
//
// A close cousin of the Registrar/RMO shape, but with an FTE/hours row
// two rows below each name row (like the consultant section, minus the
// CALL OBLIGATION row in between), and shift codes written the other way
// around — location first, then time ("ED 1030-2030", "Ward 0800-1800")
// rather than "Day/Night/Evening HHMM-HHMM \nLOCATION". Section starts
// at its own "Week 1" header (row 158 in the current DRAFT file, under
// "Interns") and ends at the validation/summary panel below it
// ("On Call Correct?" onwards — headcounts and staffing-check rows, not
// roster data, so explicitly excluded rather than accidentally parsed
// as more people).
export const INTERN_SECTION_START_ROW = 158;

// Confirmed with the department (2026-08-25) — bare "Ward" (no number)
// means Ward 1.
const INTERN_LOCATION_TOKEN_MAP = {
  'ED': { location: 'Emergency', activity: 'Emergency Department Cover' },
  'WARD': { location: 'Ward 1', activity: 'Ward Care Cover' },
};

export function resolveInternShiftCode(rawCode) {
  const code = (rawCode || '').replace(/\s+/g, ' ').trim();
  if (!code) return null;

  const timeMatch = code.match(TIME_RANGE_RE);
  if (timeMatch) {
    const locationToken = code.replace(TIME_RANGE_RE, '').trim().toUpperCase();
    const mapped = INTERN_LOCATION_TOKEN_MAP[locationToken];
    if (mapped) return clinicalSegment(mapped.location, mapped.activity, normalizeHHMM(timeMatch[1]), normalizeHHMM(timeMatch[2]));
  }

  // Falls back to the RMO resolver (which itself falls back to the
  // consultant map) in case an intern's cell uses the same shorthand —
  // leave codes in particular are shared across every section.
  const viaRmo = resolveRmoShiftCode(code);
  if (!viaRmo.unmapped) return viaRmo;

  return { unmapped: code };
}

export function extractInternWeek(rows, sectionStartRow, mondayCol) {
  const dateRowIndex = sectionStartRow + 1;
  const dates = DAY_LABELS.map((_, i) => (rows[dateRowIndex]?.[mondayCol + i] || '').toString().trim());

  const people = [];
  for (let r = sectionStartRow + 2; r < rows.length; r++) {
    const col0 = (rows[r][0] || '').toString().trim();
    if (/^Week\s+\d/i.test(col0)) break;
    if (col0 === 'On Call Correct?') break; // start of the validation/summary panel
    if (!col0) continue;
    if (/^\d+(\.\d+)?$/.test(col0)) continue; // FTE/hours row for the person just above, not a new person

    const days = DAY_LABELS.map((label, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      return {
        label,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveInternShiftCode(rawShift) : null,
      };
    });

    people.push({ rawLabel: col0, days });
  }

  return people;
}

export function parseInternWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const mondayCol = WEEK_BLOCK_MONDAY_COLUMNS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this file only has ${WEEK_BLOCK_MONDAY_COLUMNS.length} week blocks`);
  }
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return extractInternWeek(rows, INTERN_SECTION_START_ROW, mondayCol);
}
