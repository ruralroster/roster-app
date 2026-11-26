// Pure helpers for pay variations — on-call callbacks and overtime (see
// migrations/2026-10-14_callbacks.sql, 2026-10-15_pay_variations_overtime.sql
// and CallbackPanel.jsx) — kept free of Supabase/React so they can be unit
// tested.

import { toLocalDateStr } from './dateUtils';

// Callbacks/overtime shorter than this get a "record it or discard it?"
// choice when stopped; anything at or over it is recorded automatically.
export const SHORT_CALL_MS = 15 * 60 * 1000;

// The Overtime button is live from this long before a rostered shift ends
// until OVERTIME_AFTER_MS after it ends.
export const OVERTIME_BEFORE_END_MS = 30 * 60 * 1000;
export const OVERTIME_AFTER_END_MS = 4 * 60 * 60 * 1000;

// Minimum break after a call before the person should be back at work.
export const FATIGUE_BREAK_MS = 10 * 60 * 60 * 1000;

// How long the "don't reattend until…" fatigue notice stays up.
export const FATIGUE_NOTICE_MS = 10 * 1000;

function atTime(dateStr, timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m || 0, s || 0, 0);
  return d;
}

// Real start/end instants of a duty type's window on a given date. An end
// time at or before the start time means the window runs overnight into
// the next day (e.g. 21:00-08:00).
export function onCallWindow(dateStr, startTime, endTime) {
  const start = atTime(dateStr, startTime);
  const end = atTime(dateStr, endTime);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

// Every one of this person's duty assignments (yesterday's and today's — an
// overnight slot started yesterday is still live this morning) that's an
// on-call window containing `now` — someone can be on call for more than
// one slot at once (e.g. ED + Anaesthetics), and gets a Callback button for
// each. Returns [{ date, duty_type, label, start, end }]. Duty types without
// times, or not counted as on call, never match.
export function findActiveOnCalls(dutyAssignments, dutyTypes, now = new Date()) {
  const result = [];
  for (const da of dutyAssignments) {
    const dt = dutyTypes.find(t => t.key === da.duty_type);
    if (!dt || !dt.counts_as_on_call || !dt.start_time || !dt.end_time) continue;
    if (result.some(r => r.date === da.date && r.duty_type === da.duty_type)) continue;
    const { start, end } = onCallWindow(da.date, dt.start_time, dt.end_time);
    if (now >= start && now < end) {
      result.push({ date: da.date, duty_type: da.duty_type, label: dt.label, start, end });
    }
  }
  return result;
}

// This person's rostered shifts (staff_assignments with joined `shifts`,
// yesterday's and today's) whose overtime window — 30 min before the shift
// ends to 4 h after — contains `now`. One entry per date+shift (a
// multi-session shift has several rows). On-call rows are skipped: those
// get Callback, not Overtime. Returns [{ date, shift_id, label, end }].
export function findOvertimeShifts(assignments, onCallShiftIds, now = new Date()) {
  const result = [];
  for (const a of assignments) {
    const shift = a.shifts;
    if (!a.shift_id || !shift?.start_time || !shift?.end_time) continue;
    if (a.on_call || onCallShiftIds.includes(a.shift_id)) continue;
    if (result.some(r => r.date === a.date && r.shift_id === a.shift_id)) continue;
    const { end } = onCallWindow(a.date, shift.start_time, shift.end_time);
    if (now >= end.getTime() - OVERTIME_BEFORE_END_MS && now < end.getTime() + OVERTIME_AFTER_END_MS) {
      result.push({ date: a.date, shift_id: a.shift_id, label: shift.name, end });
    }
  }
  return result;
}

// How tapping Overtime at `now` starts the record, for a shift ending at
// `end`: 'scheduled' — tapped in the 30 min before the end, so the record
// starts at the shift end and the timer waits until then; 'ask' — tapped
// after the end, so the person is asked whether they've been on overtime
// since the shift ended (start = shift end) or are only starting now.
export function overtimeStartMode(end, now = new Date()) {
  return now < new Date(end) ? 'scheduled' : 'ask';
}

export const VARIATION_KIND_LABEL = { callback: 'Callback', overtime: 'Overtime', callin: 'Called in' };
const kindLabel = (kind) => VARIATION_KIND_LABEL[kind] || 'Callback';

// What a stored variation row was for: the on-call slot's label, or the
// shift's name for overtime (needs `shifts(name)` joined).
export function variationFor(row, dutyTypes) {
  if (row.kind === 'callin') return 'not on call';
  return row.kind === 'overtime'
    ? row.shifts?.name || ''
    : dutyTypes.find(d => d.key === row.duty_type)?.label || row.duty_type || '';
}

// "Callback — ED On-Call" / "Overtime — Morning".
export function variationLabel(row, dutyTypes) {
  const what = variationFor(row, dutyTypes);
  return `${VARIATION_KIND_LABEL[row.kind] || 'Callback'}${what ? ` — ${what}` : ''}`;
}

export function fatigueReturnTime(endedAt) {
  return new Date(new Date(endedAt).getTime() + FATIGUE_BREAK_MS);
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// "1h 25m" / "8m" — for the callbacks list and exports.
export function formatDuration(ms) {
  const mins = Math.round(Math.max(0, ms) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(date) {
  return new Date(date).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatCallDate(date) {
  return new Date(date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// The text file downloaded to the staff member's phone when a variation is
// stopped — the only place the patient details ever go.
// A variation's short reference ("V-4F2K"), from its id: on the ESO's
// Monday list, the doctor's email and the text file, so they can be
// matched up.
export function variationRef(callbackId) {
  return `V-${String(callbackId || '').replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

const clean = (v) => String(v ?? '').replace(/[|\r\n]+/g, ' ').trim();
const isoDate = (d) => toLocalDateStr(new Date(d));

// The one machine-readable line each email and text file carries, for the
// ESO's collator: RSTAR|ref|type|date|start|end|minutes|staff|for|MRN|surname|first name.
export function esoSummaryLine({ ref, kind, label, startedAt, endedAt, staffName, mrn, surname, firstName }) {
  const minutes = Math.round((new Date(endedAt) - new Date(startedAt)) / 60000);
  return ['RSTAR', ref, kindLabel(kind), isoDate(startedAt), formatClock(startedAt), formatClock(endedAt), minutes,
    clean(staffName), clean(label), clean(mrn), clean(surname).toUpperCase(), clean(firstName)].join('|');
}

// A text file's (or email's) RSTAR line back into its parts; null if none.
export function parseEsoSummaryLines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('RSTAR|')).map(l => {
    const [, ref, type, date, start, end, minutes, staff, what, mrn, surname, firstName] = l.split('|');
    return { ref, type, date, start, end, minutes: Number(minutes) || 0, staff, what, mrn, surname, firstName };
  });
}

// The email to the department's ESO for one or more variations: subject
// and body, readable, with each one's RSTAR line under it.
export function buildEsoEmail(staffName, variations) {
  const first = variations[0];
  const subject = variations.length === 1
    ? `Pay variation ${first.ref}: ${kindLabel(first.kind)}, ${formatCallDate(first.startedAt)}`
    : `Pay variations: ${variations.length} from ${staffName || 'me'}`;
  const blocks = variations.map(v => {
    const patient = [v.mrn && `MRN ${v.mrn}`, (v.surname || v.firstName) && [String(v.surname || '').toUpperCase(), v.firstName].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return [
      `${v.ref} · ${kindLabel(v.kind)}${v.label ? ` (${v.label})` : ''}`,
      `${formatCallDate(v.startedAt)}, ${formatClock(v.startedAt)}–${formatClock(v.endedAt)} (${formatDuration(new Date(v.endedAt) - new Date(v.startedAt))})`,
      `Patient: ${patient || 'not given'}`,
      esoSummaryLine({ ...v, staffName }),
    ].join('\n');
  });
  return { subject, body: `${blocks.join('\n\n')}\n\n${staffName || ''}\n` };
}

export const mailtoHref = (to, { subject, body }) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export function buildCallbackNoteText({ staffName, variationLabel: label, startedAt, endedAt, mrn, surname, firstName, ref, kind }) {
  const lines = [
    'Pay variation',
    ...(ref ? [`Ref: ${ref}`] : []),
    `Staff: ${staffName || ''}`,
    `Type: ${label || ''}`,
    `Date: ${formatCallDate(startedAt)}`,
    `Call started: ${formatClock(startedAt)}`,
    `Call completed: ${formatClock(endedAt)}`,
    `Duration: ${formatDuration(new Date(endedAt) - new Date(startedAt))}`,
  ];
  if (mrn) lines.push(`MRN: ${mrn}`);
  if (surname || firstName) lines.push(`Patient: ${[surname?.toUpperCase(), firstName].filter(Boolean).join(', ')}`);
  if (ref) lines.push('', esoSummaryLine({ ref, kind, label, startedAt, endedAt, staffName, mrn, surname, firstName }));
  return `${lines.join('\n')}\n`;
}

// "Rstar variation 2026-11-24 2240 V-4F2K.txt": easy to spot and pick
// together in the phone's files.
export function callbackNoteFilename(startedAt, ref) {
  const d = new Date(startedAt);
  const pad = n => String(n).padStart(2, '0');
  return `Rstar variation ${toLocalDateStr(d)} ${pad(d.getHours())}${pad(d.getMinutes())}${ref ? ` ${ref}` : ''}.txt`;
}

// Calls longer than this are rejected when editing times — almost
// certainly a typo (wrong day) rather than a real call.
export const MAX_CALL_MS = 24 * 60 * 60 * 1000;

// Date → the 'YYYY-MM-DDTHH:MM' local string a <input type="datetime-local">
// expects.
export function toDateTimeLocalValue(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${toLocalDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Error message for an edited start/end pair, or null if it's fine.
export function validateCallTimes(startedAt, endedAt, now = new Date()) {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Enter both a start and an end time.';
  if (end <= start) return 'The call must end after it started.';
  if (end > now) return "The end time can't be in the future.";
  if (end - start > MAX_CALL_MS) return 'A call can be at most 24 hours long — check the dates.';
  return null;
}
