import * as XLSX from 'xlsx';
import { SESSION_DEFAULT_TIMES } from './shiftSessionUtils';

// ============================================================
// ROSTER EXCEL IMPORT — SMO/Consultant section only
// ============================================================
//
// Converts the department's hand-built Excel roster
// (exelRosters/*.xlsx) into the same location+activity+shift/leave/
// on-call shape the rest of the app already uses.
//
// The file has no clean tabular schema — it's a stack of manually
// laid-out sections with a different row pattern per staff group
// (Registrars/RMOs, Locums, a Standby summary, and the SMO/Consultant
// section). Deliberately scoped to JUST the SMO/Consultant section for
// now — it's the one section with a reliable structural anchor; the
// others need their own investigation before they can be parsed safely.
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
