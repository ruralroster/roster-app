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
// laid-out sections with a different row pattern per staff group. Four
// sections are covered so far: SMO/Consultant (below), Registrar/RMO,
// Intern (further down), and Locums (see "ROSTER EXCEL IMPORT — Locums
// section" below — added 2026-09-23 once it became clear a locum with no
// staff record yet was silently dropped from the import, rather than
// surfaced for the officer to add). The Standby/AF summary panel still
// needs its own investigation before it can be parsed safely (it's a
// backup-contact lookup table, not a per-person roster, so it doesn't fit
// this module's shape at all) — see the conversation history this was
// built from.
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

// Confirmed with the department (2026-08-25, revised 2026-08-26 against
// the department's actual locations/activities — several early guesses
// didn't match: there's no "Theatre" location, "General Theatre" isn't an
// activity, "Ward (1&2)" isn't an activity, and "Chemo" doesn't exist at
// all) — see conversation history for the reasoning behind each mapping.
// Keys are matched case-sensitively against the trimmed cell text (or
// half of an "X/Y" split code). The department only actively uses the
// generic "Clinic" location — "Clinic (Anaes/Med/Obs)" all exist but are
// disabled, so every clinic-ish code maps to plain "Clinic".
const SINGLE_CODE_MAP = {
  'AL': { leaveCode: 'AL' },
  'S/L': { leaveCode: 'SL' }, // Study Leave, not Sick Leave
  'PDL': { leaveCode: 'PDL' }, // Professional Development Leave
  'LSL': { leaveCode: 'LSL' }, // Long Service Leave — confirmed 2026-09-15
  'OFF': { segments: [] }, // not a leave type — just means nothing rostered, same as a blank cell
  'ED': clinicalSegment('Emergency', 'Emergency Department Cover', '08:00', '18:00'),
  'EDL + OC': clinicalSegment('Emergency', 'Emergency Department Cover', '10:30', '21:00'),
  'Ward 1': clinicalSegment('Ward 1', 'Ward Care Cover', '08:00', '18:00'),
  'Ward 2': clinicalSegment('Ward 2', 'Ward Care Cover', '08:00', '18:00'),
  'WARD (1&2)': clinicalSegment('Ward 1 and 2 (Weekend Cover)', 'Ward Care Cover', '08:00', '18:00'),
  'Maternity': clinicalSegment('Maternity', 'Ward Care Cover', '08:00', '18:00'),
  'Admin': clinicalSegment('Non-clinical', 'Admin', '08:00', '18:00'),
  'DMS': clinicalSegment('Non-clinical', 'Admin', '08:00', '18:00'),
  'Concessional Day': clinicalSegment('Non-clinical', 'Admin', '08:00', '18:00'),
  'Endo': clinicalSegment('Endoscopy', 'Endoscopy', '08:00', '18:00'),
  'OT': clinicalSegment('General Theatre', 'General Surgery', '08:00', '18:00'),
  'Dental': clinicalSegment('General Theatre', 'Paediatric Dental', '08:00', '18:00'),
  'Obs Clinic': clinicalSegment('Clinic', 'Obstetrics', '08:00', '18:00'),
  'ANC': clinicalSegment('Clinic', 'Obstetrics', '08:00', '18:00'),
  'ObsC': clinicalSegment('Clinic', 'Obstetrics', '08:00', '18:00'),
  'Obs': clinicalSegment('Clinic', 'Obstetrics', '08:00', '18:00'),
  'Anaes clinic': clinicalSegment('Clinic', 'Anaesthetics', '08:00', '18:00'), // confirmed 2026-09-15
};

// Resolves one day's shift-cell text. A plain code looks itself up
// directly; an "X/Y" code always splits into an AM half (the part
// before the slash) and a PM half (the part after) at the confirmed
// session-border times (09:00–12:00 / 12:30–18:00) — confirmed
// 2026-08-27: this overrides whatever fixed time that half's own
// standalone code carries (e.g. ED's real 08:00–18:00) since the slash
// specifically means "this half only, split at the session border," not
// "both halves, full day." Anything not in SINGLE_CODE_MAP comes back
// tagged `unmapped` rather than silently guessed at, so nothing goes
// missing without being visible to whoever reviews the output.
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
          { ...amSeg, start: AM.start, end: AM.end },
          { ...pmSeg, start: PM.start, end: PM.end },
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
// section starts at its own "Week 1"/date header pair (under the "PHO"
// org unit) and runs until the next "Week N" header (the Interns
// section).
//
// The shift codes here are also a different *shape* from the consultant
// section — longhand ("Day 0800 -1800 \nED") rather than terse
// abbreviations — so they get their own resolver, though "X/Y" split
// codes (e.g. "OT/ED") reuse the consultant section's map and split
// logic directly since those tokens are shared.
//
// The section's start row used to be a hardcoded constant, but it drifts
// between roster periods as the number of consultants above it changes
// (confirmed 2026-09-15: the 2026-10-12 DRAFT file's Intern section had
// shifted 4 rows from the 2026-08-17 file this was built against, which
// silently dropped the first intern and misread another's dates against
// an FTE/hours row) — so, like the Consultant section's "CALL
// OBLIGATION" anchor, it's now found dynamically.
//
// Every section (including each Consultant specialty sub-block —
// Anaesthetics, Obstetrics, etc. each repeat their own "Week 1"/date
// header) is preceded by a title in column I (index 8) two rows above
// its "Week 1" header — "PHO" for the RMO/Registrar section, "Interns"
// for the Intern section. Matching on that title (rather than just
// counting "Week 1" occurrences) is what tells the RMO/Intern sections
// apart from the Consultant sub-blocks that share the same header shape.
export function findLabeledWeekHeaderRow(rows, labelRegex) {
  for (let r = 0; r < rows.length; r++) {
    const label = (rows[r][8] || '').toString().trim();
    if (labelRegex.test(label)) {
      for (let k = r + 1; k < Math.min(r + 4, rows.length); k++) {
        if ((rows[k][0] || '').toString().trim() === 'Week 1') return k;
      }
    }
  }
  return undefined;
}

const TIME_RANGE_RE = /(\d{3,4})\s*-\s*(\d{3,4})/;

function normalizeHHMM(raw) {
  const digits = raw.padStart(4, '0');
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// Confirmed with the department (2026-08-25, extended 2026-08-27):
//   - "Night ####-####" / "Evening ####-####" / "Afternoon ####-####"
//     have no location suffix — all three are always Emergency /
//     Emergency Department Cover (the EDL on-call shift).
//   - "Day ####-####" always carries an explicit location suffix after
//     the newline (e.g. "ED", "WARD 1"), resolved via this table.
const RMO_DAY_LOCATION_TOKEN_MAP = {
  'ED': { location: 'Emergency', activity: 'Emergency Department Cover' },
  'WARD 1': { location: 'Ward 1', activity: 'Ward Care Cover' },
  'MATERNITY': { location: 'Maternity', activity: 'Ward Care Cover' },
};

// "Chemo" isn't its own activity in this department — confirmed
// (2026-08-26) it maps to the same "Medical Clinic" activity as bare
// "Clinic", and both are 08:00-18:00 (confirmed 2026-08-26).
const RMO_BARE_CODE_MAP = {
  'A/L': { leaveCode: 'AL' },
  'GP': { leaveCode: 'GP' },
  'PDL': { leaveCode: 'PDL' }, // Professional Development Leave
  'LSL': { leaveCode: 'LSL' }, // Long Service Leave — confirmed 2026-09-15
  'Day Shift': clinicalSegment('Ward 1', 'Ward Care Cover', '08:00', '18:00'),
  'Clinic': clinicalSegment('Clinic', 'Medical Clinic', '08:00', '18:00'),
  'Chemo': clinicalSegment('Clinic', 'Medical Clinic', '08:00', '18:00'),
  'OFF': { segments: [] }, // not a leave type — just means nothing rostered, same as a blank cell
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

    if (/^Night/i.test(code) || /^Evening/i.test(code) || /^Afternoon/i.test(code)) {
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
  const sectionStartRow = findLabeledWeekHeaderRow(rows, /^PHO$/i);
  if (sectionStartRow === undefined) {
    throw new Error('Could not find the RMO/Registrar section ("Week 1" header under "PHO") in this file');
  }
  return extractRmoWeek(rows, sectionStartRow, mondayCol);
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
// at its own "Week 1" header (under "Interns") and ends at the
// validation/summary panel below it ("On Call Correct?" onwards —
// headcounts and staffing-check rows, not roster data, so explicitly
// excluded rather than accidentally parsed as more people).

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
  const sectionStartRow = findLabeledWeekHeaderRow(rows, /^Interns$/i);
  if (sectionStartRow === undefined) {
    throw new Error('Could not find the Intern section ("Week 1" header under "Interns") in this file');
  }
  return extractInternWeek(rows, sectionStartRow, mondayCol);
}

// ============================================================
// ROSTER EXCEL IMPORT — Locums section
// ============================================================
//
// Unlike every other section, a locum's name isn't written once per row
// spanning all 4 week blocks — a different locum can fill the same row
// in different weeks, so the name lives in its own column right before
// each week block's Monday column (mondayCol - 1), same as the shift
// data next to it. Confirmed against both the 2026-08-17 and 2026-10-12
// DRAFT files: e.g. row 78's column 18 name ("Jaden Bollman
// Anaesthetics") and column 26 name in the same row belong to two
// different week blocks, not two people on one row.
//
// The section has no FTE row — the row below a name is an on-call note
// (like the Consultant section's CALL OBLIGATION row, minus the label),
// which isn't imported yet (see importRosterWeek — it only reads
// leaveCode/segments). A contact line ("Igor MOB: 0433146113") sometimes
// sits one row above the name, in the week block's own Monday column —
// same place the Consultant section reads its contactLine from.
//
// The section is found by its "LOCUMS" label (columns 7 and 25 in the
// files seen so far — one per pair of week blocks) rather than a fixed
// row/column, then anchored to the next "Week 1"/"Week 2" header row
// immediately below it, which — unlike every other section — covers all
// 4 week blocks in one row (columns 0/8/18/26).
export function findLocumsSectionStartRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    const hasLocumsLabel = (rows[r] || []).some(cell => (cell || '').toString().trim().toUpperCase() === 'LOCUMS');
    if (hasLocumsLabel) {
      for (let k = r + 1; k < Math.min(r + 3, rows.length); k++) {
        if ((rows[k][0] || '').toString().trim() === 'Week 1') return k;
      }
    }
  }
  return undefined;
}

export function extractLocumsWeek(rows, sectionStartRow, mondayCol) {
  const dateRowIndex = sectionStartRow + 1;
  const dates = DAY_LABELS.map((_, i) => (rows[dateRowIndex]?.[mondayCol + i] || '').toString().trim());
  const nameCol = mondayCol - 1;

  const people = [];
  for (let r = sectionStartRow + 2; r < rows.length; r++) {
    const col0 = (rows[r][0] || '').toString().trim();
    if (/^Week\s+\d/i.test(col0)) break; // next section (Standby/AF panel)

    const rawLabel = (rows[r][nameCol] || '').toString().trim();
    // Two false-positive shapes to skip, not a person: "CALL OBLIGATION"
    // landing in a week block's name column on the row just above the
    // next section's header, and a contact line ("Igor MOB: 0433146113")
    // landing directly in the name column — rather than in the Monday
    // column contactLine normally reads from below — one row above the
    // real name row. That contact line is still picked up as this
    // person's phone number via the contactRow[nameCol] fallback below;
    // it just shouldn't become a "person" of its own.
    if (!rawLabel || rawLabel.toUpperCase() === 'CALL OBLIGATION' || /\bMOB\b/i.test(rawLabel)) continue;

    const contactRow = rows[r - 1] || [];
    const days = DAY_LABELS.map((label, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      return {
        label,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveShiftCode(rawShift) : null,
      };
    });

    people.push({
      rawLabel,
      contactLine: (contactRow[mondayCol] || contactRow[nameCol] || '').toString().trim(),
      days,
    });
  }

  return people;
}

// Tolerant of a workbook with no Locums section at all (returns []
// rather than throwing) — unlike the Consultant/RMO/Intern sections,
// which are load-bearing enough that a missing one means the file isn't
// what this parser expects, a department that genuinely has no locums
// this week (or ever) shouldn't block the rest of the import.
export function parseLocumsWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const mondayCol = WEEK_BLOCK_MONDAY_COLUMNS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this file only has ${WEEK_BLOCK_MONDAY_COLUMNS.length} week blocks`);
  }
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const sectionStartRow = findLocumsSectionStartRow(rows);
  if (sectionStartRow === undefined) return [];
  return extractLocumsWeek(rows, sectionStartRow, mondayCol);
}

// ============================================================
// STAFF NAME MATCHING
// ============================================================
//
// Matches a raw Excel label (e.g. "James Boland Anaesthetics",
// "Medical Registrar - Sam Cherian") against a real staff list by name.
// A raw label is always "<real name>" optionally followed by trailing
// speciality words ("Anaesthetics", "Endo/Anaesthetics", "ED", ...) or
// preceded by a "Medical Registrar - " prefix — never anything that
// changes the name itself — so matching is: strip the known prefix, then
// find the longest staff name that the remaining text starts with.
// Deliberately doesn't fuzzy-match beyond that (e.g. no edit-distance
// scoring) — a wrong staff match on roster data is a patient-safety
// issue, not a cosmetic one, so anything that isn't a clean prefix match
// comes back null for a human to resolve, never a best-effort guess.
//
// The one deliberate exception: known nicknames the spreadsheet uses
// that don't prefix-match the staff record's real first name (e.g.
// "Becky" for "Rebecca" Coxon). This isn't a spreadsheet typo to fix at
// the source and it isn't something to rename in the database either —
// "Rebecca" is her correct name and the spreadsheet will keep saying
// "Becky" every week — so the alias lives here instead. Add to this list
// as new ones turn up; each one confirmed against a real person, never
// guessed.
const NICKNAME_ALIASES = {
  'becky': 'rebecca',
};

function applyNicknameAlias(text) {
  const [first, ...rest] = text.split(/\s+/);
  const alias = NICKNAME_ALIASES[first.toLowerCase()];
  return alias ? [alias, ...rest].join(' ') : text;
}

export function matchStaffName(rawLabel, staffList) {
  const cleaned = (rawLabel || '').replace(/^Medical Registrar\s*-\s*/i, '').trim();
  if (!cleaned) return null;

  const candidates = [cleaned, applyNicknameAlias(cleaned)];

  for (const candidate of candidates) {
    const exact = staffList.find(s => s.name.trim().toLowerCase() === candidate.toLowerCase());
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const prefixMatches = staffList
      .filter(s => candidate.toLowerCase().startsWith(s.name.trim().toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length);
    if (prefixMatches[0]) return prefixMatches[0];
  }

  return null;
}

// A best-effort guess at a real first-and-last name from a raw label that
// matched no existing staff record — used only to pre-fill the "add this
// person as staff" dialog's name field, which the officer always reviews
// and can edit before confirming (never used to silently create a staff
// record, and never fed back into matchStaffName). Strips the same
// "Medical Registrar - " prefix matchStaffName does, plus whatever
// trailing speciality word the label was built from (e.g. "Adrian Connor
// Anaesthetics", "Becky Coxon               ED", "Emma Pickstone
// Endo/Anaesthetics") — repeatedly, in case more than one trails the name.
const TRAILING_SPECIALTY_RE = /\s+(Anaesthetics(\/Endo)?|Endo(\/Anaesthetics)?|Obstetrics|ED)\s*$/i;

export function suggestStaffName(rawLabel) {
  const cleaned = (rawLabel || '').replace(/^Medical Registrar\s*-\s*/i, '').replace(/\s+/g, ' ').trim();
  let stripped = cleaned;
  for (let next = stripped.replace(TRAILING_SPECIALTY_RE, '').trim(); next !== stripped; next = stripped.replace(TRAILING_SPECIALTY_RE, '').trim()) {
    stripped = next;
  }
  return stripped || cleaned;
}

// Pulls a mobile number out of a contact line like "Igor MOB: 0433146113"
// or "Becky Coxon MOB : 0455897758" — used to pre-fill the "add this
// person as staff" dialog's phone field when the roster happens to carry
// one (the Consultant/Locums sections' contact lines; the PHO/Registrar
// and Intern sections generally don't have one, which isn't an issue
// since neither group takes on-call).
export function extractPhoneFromContactLine(contactLine) {
  if (!contactLine) return null;
  const match = contactLine.match(/MOB\s*:?\s*([\d ]{8,})/i);
  return match ? match[1].replace(/\s+/g, '').trim() : null;
}

// The real Mon/Sun dates for each of the file's week blocks — lets a
// picker show "Week 2 (24/08–30/08)" instead of an opaque index.
export function getWeekDateRanges(workbook, sheetName = 'Sheet1') {
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return WEEK_BLOCK_MONDAY_COLUMNS.map(mondayCol => ({
    start: (rows[DATE_ROW_INDEX]?.[mondayCol] || '').toString().trim(),
    end: (rows[DATE_ROW_INDEX]?.[mondayCol + 6] || '').toString().trim(),
  }));
}

// Runs all four section parsers for one week and concatenates them — the
// whole-week input importRosterWeek expects.
export function parseRosterWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  return [
    ...parseConsultantWeek(workbook, weekIndex, sheetName),
    ...parseRmoWeek(workbook, weekIndex, sheetName),
    ...parseInternWeek(workbook, weekIndex, sheetName),
    ...parseLocumsWeek(workbook, weekIndex, sheetName),
  ];
}
