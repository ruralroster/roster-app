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
// sections are covered: SMO/Consultant (below), Locum, Registrar/RMO,
// and Intern (further down). Locums were skipped at first; included
// since 2026-09-25 at the department's request. The Standby/AF summary
// panel still needs its own investigation before it can be parsed safely (it's
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
  'WARD (1&2)': clinicalSegment('Ward 1 and 2 (Weekend Cover)', 'Ward Care Cover', '08:00', '18:00'), // weekday -> both wards, see splitWeekdayBothWards
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

// Fills in, after parsing, any day whose code came back `unmapped` using
// the officer's own saved code mappings (roster_import_mappings, kind
// 'code' — see RosterExcelImportTab.jsx). codeMap is { code: resolved }
// in the same { segments } / { leaveCode } shape the resolvers return;
// baseResolve is the format's own resolver, used for the known half of a
// split code. Works for either format's parsed output.
//
// An "X/Y" split code with exactly one unknown half comes back as
// `unmapped: <that half>` (with `within` the whole code), not the whole
// code — so mapping "Endo2" once fixes "OT/Endo2", "Endo2/ED" and so on.
export function applyCodeMappings(people, codeMap, baseResolve) {
  const lookup = (c) => codeMap[c] || baseResolve(c);

  const resolve = (rawShift, current) => {
    const trimmed = (rawShift || '').trim();
    const code = trimmed.replace(/\s+/g, ' ');
    if (codeMap[trimmed] || codeMap[code]) return codeMap[trimmed] || codeMap[code];
    if (!code.includes('/')) return current;

    const [amPart, pmPart] = code.split('/').map(s => s.trim());
    const am = amPart ? lookup(amPart) : null;
    const pm = pmPart ? lookup(pmPart) : null;
    if (am?.segments?.length && pm?.segments?.length) {
      return {
        segments: [
          { ...am.segments[0], start: AM.start, end: AM.end },
          { ...pm.segments[0], start: PM.start, end: PM.end },
        ],
      };
    }
    const unknown = [amPart, pmPart].filter((part, i) => part && (i === 0 ? am : pm)?.unmapped);
    if (unknown.length === 1) return { unmapped: unknown[0], within: code };
    return current;
  };

  return people.map(person => ({
    ...person,
    days: person.days.map(day => (
      day.resolvedShift?.unmapped ? { ...day, resolvedShift: resolve(day.rawShift, day.resolvedShift) } : day
    )),
  }));
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

  // Name read from this week block's own label column, same as the
  // registrar/intern/locum sections (see weekLabel) — checked 2026-09-25:
  // every consultant row in the Sept/Oct/Dec INNH files carries the same
  // name in all four blocks today, but a slot handed to someone else
  // mid-file must not file their shifts under column A's name.
  return anchors.flatMap(r => {
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

    const label = rowLabelForWeek(nameRow, mondayCol, days);
    if (!label) return hasRealShift(days) ? [unnamedPerson(r - 1, days)] : [];

    return [{
      rawLabel: label,
      contactLine: (contactRow[mondayCol] || contactRow[0] || '').toString().trim(),
      fte: (fteRow[mondayCol - 1] || fteRow[0] || '').toString().trim(),
      days,
    }];
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
// ROSTER EXCEL IMPORT — Locum section
// ============================================================
//
// Confirmed against all three INNH files (Sept, Oct, Dec 2026): a
// "LOCUMS" header row, then its own "Week 1"/date header pair, then one
// name row per locum slot with an on-call note row directly under it
// (same notes as the consultants' CALL OBLIGATION row, just unlabelled),
// running until the Standby panel's own "Week 1" header. Unlike every
// other section, the name is in EACH week block's own label column
// (the column just left of that block's Monday) rather than always
// column A — a slot is filled by different locums in different weeks
// (e.g. Leonie Fromberg in week 1, Rob Johnston in weeks 2-3 of the same
// row), and a week with nobody in that slot has a blank label there.
// Shift codes are the consultant section's own (Maternity, ED, EDL +
// OC, ANC/Obs...), so they share resolveShiftCode.
export function extractLocumWeek(rows, mondayCol) {
  const headerRow = rows.findIndex(row => row.some(cell => (cell || '').toString().trim().toUpperCase() === 'LOCUMS'));
  if (headerRow === -1) return [];
  let weekRow = headerRow + 1;
  while (weekRow < rows.length && !/^Week\s+\d/i.test((rows[weekRow][0] || '').toString().trim())) weekRow++;
  if (weekRow >= rows.length) return [];

  const labelCol = mondayCol - 1;
  const dates = DAY_LABELS.map((_, i) => (rows[weekRow + 1]?.[mondayCol + i] || '').toString().trim());

  const people = [];
  for (let r = weekRow + 2; r < rows.length; r++) {
    if (/^Week\s+\d/i.test((rows[r][0] || '').toString().trim())) break;
    // The on-call notes row sits directly under a name row and its notes
    // ("Obs") are also real shift codes, so it must never be read as a
    // nameless shift row itself. Name rows are always 2+ rows apart.
    const prevRow = rows[r - 1] || [];
    if (WEEK_BLOCK_MONDAY_COLUMNS.some(m => isPersonLabel(weekLabel(prevRow, m)))) continue;
    const ownLabel = weekLabel(rows[r], mondayCol);
    if (ownLabel && !isPersonLabel(ownLabel)) continue; // e.g. the stray "CALL OBLIGATION" row

    const callRow = rows[r + 1] || [];
    const callRowIsNotes = !(callRow[labelCol] || '').toString().trim();
    const days = DAY_LABELS.map((dayLabel, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      const rawOnCall = callRowIsNotes ? (callRow[col] || '').toString().trim() : '';
      return {
        label: dayLabel,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveShiftCode(rawShift) : null,
        rawOnCall,
        onCall: rawOnCall ? parseOnCallNote(rawOnCall) : null,
      };
    });

    const label = rowLabelForWeek(rows[r], mondayCol, days);
    if (!label) {
      if (hasRealShift(days)) people.push(unnamedPerson(r, days));
      continue;
    }

    people.push({ rawLabel: label, days });
  }

  return people;
}

export function parseLocumWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const mondayCol = WEEK_BLOCK_MONDAY_COLUMNS[weekIndex];
  if (mondayCol === undefined) {
    throw new Error(`No week block configured for weekIndex ${weekIndex} — this file only has ${WEEK_BLOCK_MONDAY_COLUMNS.length} week blocks`);
  }
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return extractLocumWeek(rows, mondayCol);
}

// ============================================================
// PER-WEEK NAME LABELS (Registrar/RMO and Intern sections)
// ============================================================
//
// Confirmed against the INNH Oct 2026 DRAFT (2026-09-25): like the locum
// section, a registrar/intern slot can change hands mid-file — Jovie
// Decoyna's row is Irene Roy in weeks 3-4, Cameron Stevenson's is Toby
// Mungomery in weeks 2-4, and the interns' rows are blank in weeks 3-4
// (next rotation not named yet). So the name is read from EACH week
// block's own label column (just left of its Monday), never column A for
// every week — reading column A filed Irene's and Toby's shifts under
// the previous person.
//
// A row with shifts but no name in that week means the person named on
// that row in the most recent earlier week is still there — confirmed
// with the department 2026-09-25 (so the Oct DRAFT's blank intern and
// Medical Registrar weeks 3-4 are still Anya, Nicholas and Sam). Only a
// row with shifts and no name in THIS OR ANY EARLIER week of the file
// (the Dec DRAFT's three new registrar rows, its "Day Shift/Clinic/
// Chemo" Medical Registrar slot, and both intern rows) becomes an
// `unnamed` entry, which importRosterWeek reports as an error rather than
// dropping or guessing. "Has shifts" means at least one cell resolves to
// a real code — the contact line ("Alex Parfitt MOB: 04..."), notes
// ("Obs" in the RMO section) and remarks ("overtime shift") never do.

// Label-column text that isn't a person: FTE/hours numbers, the next
// section's header, and org-unit header lines.
const NON_PERSON_LABEL_RE = /^(\d+(\.\d+)?|CALL OBLIGATION|PHO|Interns|Health Profession.*|Organisational.*|Org Unit.*|Senior Health Prof.*)$/i;

function weekLabel(row, mondayCol) {
  return (row[mondayCol - 1] || '').toString().replace(/\s+/g, ' ').trim();
}

function isPersonLabel(label) {
  return !!label && !NON_PERSON_LABEL_RE.test(label);
}

// This week's name for the row, or — if it's blank but the row has real
// shifts this week — the nearest earlier week's name on the same row.
// '' if neither.
function rowLabelForWeek(row, mondayCol, days) {
  const own = weekLabel(row, mondayCol);
  if (own) return own;
  if (!hasRealShift(days)) return '';
  const idx = WEEK_BLOCK_MONDAY_COLUMNS.indexOf(mondayCol);
  for (let k = idx - 1; k >= 0; k--) {
    const earlier = weekLabel(row, WEEK_BLOCK_MONDAY_COLUMNS[k]);
    if (isPersonLabel(earlier)) return earlier;
  }
  return '';
}

function hasRealShift(days) {
  return days.some(d => d.resolvedShift && !d.resolvedShift.unmapped);
}

// Excel's own 1-based row number, so the officer can find the row.
function unnamedPerson(r, days) {
  return { rawLabel: `(no name, Excel row ${r + 1})`, unnamed: true, days };
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

// "Both wards" codes — the consultants' "WARD (1&2)" and the registrars'
// "Day 0800 -1800 WARDS". The combined location exists for weekend cover,
// but both codes also turn up on weekdays (e.g. WARDS on 20+ weekdays in
// the Sept/Oct 2026 INNH files), where it means the person covers Ward 1
// AND Ward 2 at once — confirmed with the department 2026-09-25. So a
// weekday occurrence becomes two segments, same times, one per ward; a
// Saturday/Sunday one keeps the weekend-cover location.
const WEEKEND_BOTH_WARDS_LOCATION = 'Ward 1 and 2 (Weekend Cover)';

function isWeekendDateStr(dateStr) {
  const match = (dateStr || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const dow = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getDay();
  return dow === 0 || dow === 6;
}

function splitWeekdayBothWards(people) {
  return people.map(person => ({
    ...person,
    days: person.days.map(day => {
      const segments = day.resolvedShift?.segments;
      if (!segments?.some(seg => seg.location === WEEKEND_BOTH_WARDS_LOCATION)) return day;
      if (isWeekendDateStr(day.date) !== false) return day; // weekend, or a date we can't read — leave as is
      return {
        ...day,
        resolvedShift: {
          ...day.resolvedShift,
          segments: segments.flatMap(seg => (seg.location === WEEKEND_BOTH_WARDS_LOCATION
            ? [{ ...seg, location: 'Ward 1' }, { ...seg, location: 'Ward 2' }]
            : [seg])),
        },
      };
    }),
  }));
}

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
  // Both wards — same as the consultants' "WARD (1&2)", and split the
  // same way on a weekday (see splitWeekdayBothWards).
  'WARDS': { location: WEEKEND_BOTH_WARDS_LOCATION, activity: 'Ward Care Cover' },
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
    if (weekLabel(rows[r], mondayCol) && !isPersonLabel(weekLabel(rows[r], mondayCol))) continue;

    const contactRow = rows[r - 1] || [];
    const days = DAY_LABELS.map((dayLabel, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      return {
        label: dayLabel,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveRmoShiftCode(rawShift) : null,
      };
    });

    const label = rowLabelForWeek(rows[r], mondayCol, days);
    if (!label) {
      if (hasRealShift(days)) people.push(unnamedPerson(r, days));
      continue;
    }

    people.push({
      rawLabel: label,
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
    if (weekLabel(rows[r], mondayCol) && !isPersonLabel(weekLabel(rows[r], mondayCol))) continue; // incl. the FTE/hours row under each intern

    const days = DAY_LABELS.map((dayLabel, i) => {
      const col = mondayCol + i;
      const rawShift = (rows[r][col] || '').toString().trim();
      return {
        label: dayLabel,
        date: dates[i],
        rawShift,
        resolvedShift: rawShift ? resolveInternShiftCode(rawShift) : null,
      };
    });

    const label = rowLabelForWeek(rows[r], mondayCol, days);
    if (!label) {
      if (hasRealShift(days)) people.push(unnamedPerson(r, days));
      continue;
    }

    people.push({ rawLabel: label, days });
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

// Runs all four section parsers for one week and concatenates them —
// the whole-week input importRosterWeek expects. Each person is tagged
// with their section (and FTE, where the sheet says) so an unmatched
// name's Map… form can suggest a rank and FTE — see
// RosterExcelImportTab.jsx.
export function parseRosterWeek(workbook, weekIndex, sheetName = 'Sheet1') {
  const tag = (people, section, fteOf) => people.map(p => ({ ...p, section, fte: fteOf(p) }));
  return splitWeekdayBothWards([
    ...tag(parseConsultantWeek(workbook, weekIndex, sheetName), 'consultant', p => parseClassicFte(p.fte)),
    ...tag(parseLocumWeek(workbook, weekIndex, sheetName), 'locum', () => 0),
    ...tag(parseRmoWeek(workbook, weekIndex, sheetName), 'rmo', () => 1),
    ...tag(parseInternWeek(workbook, weekIndex, sheetName), 'intern', () => 1),
  ]);
}

// The key a 'staff' import mapping is saved and looked up under — the
// raw label with its spacing normalised (the sheet isn't consistent:
// "Bradley Lovie  Obstetrics ").
export function staffLabelKey(rawLabel) {
  return (rawLabel || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ============================================================
// MISSING STAFF (classic format)
// ============================================================
//
// The classic-format counterpart to edRosterExcelImport.js's
// getEdStaffRoster — every person the file mentions, across all its week
// blocks and all four sections, so RosterExcelImportTab.jsx's "Check for
// Missing Staff" can offer to create anyone with no staff record yet
// (a new locum, or a registrar like "Jas Singh" who's never been set up).

// Trailing speciality words the labels carry after the real name
// ("Linda Thomson Obstetrics", "Rob Johnston ED", "Emma Pickstone
// Endo/Anaesthetics") — stripped to get the name to create. Only used for
// creating a record; matching an existing one is matchStaffName's
// prefix rule, which already ignores whatever trails the name.
const LABEL_SUFFIX_WORDS = new Set([
  'anaesthetics', 'anaesthetic', 'anaes', 'obstetrics', 'obs', 'ed', 'emergency',
  'endo', 'endoscopy', 'medical', 'medicine', 'gp', 'surgery', 'paediatrics',
]);

export function cleanStaffLabel(rawLabel) {
  const words = (rawLabel || '')
    .replace(/^Medical Registrar\s*-\s*/i, '')
    .replace(/\s*\((?:[\d.]+\s*FTE|Casual)\)\s*$/i, '') // the ED format's "(0.5 FTE)" / "(Casual)"
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length > 2 && words[words.length - 1].split('/').every(part => LABEL_SUFFIX_WORDS.has(part.toLowerCase()))) {
    words.pop();
  }
  return words.join(' ');
}

// "0.75", "0.5FTE", "1.0 FTE" -> number; "Casual" -> 0 (same as the ED
// format's "(Casual)"); anything else -> 1.
function parseClassicFte(raw) {
  const text = (raw || '').toString().trim();
  if (/casual/i.test(text)) return 0;
  const match = text.match(/^(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 1;
}

// [{ rawLabel, name, fte, section }] — section is 'consultant' | 'locum'
// | 'rmo' | 'intern', for the tab to suggest a rank from. Locums count as
// casual (FTE 0). Deduped by cleaned name, first sighting wins. The
// unnamed "Medical Registrar" placeholder row (an unfilled slot, not a
// person) is left out.
export function getClassicStaffRoster(workbook, sheetName = 'Sheet1') {
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const rmoStart = findLabeledWeekHeaderRow(rows, /^PHO$/i);
  const internStart = findLabeledWeekHeaderRow(rows, /^Interns$/i);

  const byName = new Map();
  const add = (rawLabel, section, fte) => {
    const name = cleanStaffLabel(rawLabel);
    if (!name || /^medical registrar$/i.test(name)) return;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { rawLabel, name, fte, section });
  };

  WEEK_BLOCK_MONDAY_COLUMNS.forEach(mondayCol => {
    extractConsultantWeek(rows, mondayCol).filter(p => !p.unnamed).forEach(p => add(p.rawLabel, 'consultant', parseClassicFte(p.fte)));
    extractLocumWeek(rows, mondayCol).forEach(p => add(p.rawLabel, 'locum', 0));
    if (rmoStart !== undefined) extractRmoWeek(rows, rmoStart, mondayCol).filter(p => !p.unnamed).forEach(p => add(p.rawLabel, 'rmo', 1));
    if (internStart !== undefined) extractInternWeek(rows, internStart, mondayCol).filter(p => !p.unnamed).forEach(p => add(p.rawLabel, 'intern', 1));
  });

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
