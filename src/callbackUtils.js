// Pure helpers for on-call callbacks (see migrations/2026-10-14_callbacks.sql
// and CallbackPanel.jsx) — kept free of Supabase/React so they can be unit
// tested.

import { toLocalDateStr } from './dateUtils';

// Calls shorter than this get a "record it or discard it?" choice at Call
// Complete; anything at or over it is recorded automatically.
export const SHORT_CALL_MS = 10 * 60 * 1000;

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

// Which of this person's duty assignments (yesterday's and today's — an
// overnight slot started yesterday is still live this morning) is an
// on-call window containing `now`. Returns { date, duty_type, label, start,
// end } or null. Duty types without times, or not counted as on call, never
// match.
export function findActiveOnCall(dutyAssignments, dutyTypes, now = new Date()) {
  for (const da of dutyAssignments) {
    const dt = dutyTypes.find(t => t.key === da.duty_type);
    if (!dt || !dt.counts_as_on_call || !dt.start_time || !dt.end_time) continue;
    const { start, end } = onCallWindow(da.date, dt.start_time, dt.end_time);
    if (now >= start && now < end) {
      return { date: da.date, duty_type: da.duty_type, label: dt.label, start, end };
    }
  }
  return null;
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

// The text file downloaded to the staff member's phone at Call Complete —
// the only place the patient details ever go.
export function buildCallbackNoteText({ staffName, dutyLabel, startedAt, endedAt, mrn, surname, firstName }) {
  const lines = [
    'On-call callback',
    `Staff: ${staffName || ''}`,
    `On call: ${dutyLabel || ''}`,
    `Date: ${formatCallDate(startedAt)}`,
    `Call started: ${formatClock(startedAt)}`,
    `Call completed: ${formatClock(endedAt)}`,
    `Duration: ${formatDuration(new Date(endedAt) - new Date(startedAt))}`,
  ];
  if (mrn) lines.push(`MRN: ${mrn}`);
  if (surname || firstName) lines.push(`Patient: ${[surname?.toUpperCase(), firstName].filter(Boolean).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export function callbackNoteFilename(startedAt) {
  const d = new Date(startedAt);
  const pad = n => String(n).padStart(2, '0');
  return `callback_${toLocalDateStr(d)}_${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
}
