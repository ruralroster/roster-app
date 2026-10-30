// Who a meeting's reminders go to, from its audience setting.
//
// audience (meetings.audience / meeting_types.audience, jsonb):
//   { mode: 'everyone' }   everyone in the department
//   { mode: 'on_shift' }   everyone working that day
//   { mode: 'seniors' }    every senior (a rank with requires_supervision = false)
//   { mode: 'juniors' }    every junior
//   { mode: 'custom', ranks: [...], scope: 'all' | 'working' | 'people', staffIds: [...] }
//     ranks narrows to those ranks; scope then picks all of them, only
//     those working that day, or the people ticked in staffIds.
//
// "Working" means rostered on a shift or an on-call slot that day. People
// marked unavailable that day (leave, a day off, working elsewhere) are
// always left out, except someone ticked by name, who was picked on purpose.
//
// supabase/functions/_shared/meetingAudience.js is a byte-for-byte copy for
// the meeting-reminders Edge Function; meetingAudience.test.js fails if
// they drift. Edit this one, then copy it across.

export const AUDIENCE_MODES = [
  { mode: 'everyone', label: 'Everyone' },
  { mode: 'on_shift', label: 'Everyone on shift' },
  { mode: 'seniors', label: 'Seniors' },
  { mode: 'juniors', label: 'Juniors' },
  { mode: 'custom', label: 'Custom…' },
];

export const DEFAULT_AUDIENCE = { mode: 'on_shift' };

const isSeniorRank = (rank, rankRows) => {
  const row = (rankRows || []).find(r => r.rank === rank);
  return row ? row.requires_supervision === false : false;
};

// staff: active staff rows ({ staff_id, rank, ... }).
// workingIds / awayIds: Sets of staff_ids working / unavailable that day.
export function meetingRecipients(audience, { staff, rankRows, workingIds, awayIds }) {
  const a = audience || DEFAULT_AUDIENCE;
  const notAway = (s) => !awayIds.has(s.staff_id);
  const working = (s) => workingIds.has(s.staff_id);
  switch (a.mode) {
    case 'everyone':
      return staff.filter(notAway);
    case 'seniors':
      return staff.filter(s => notAway(s) && isSeniorRank(s.rank, rankRows));
    case 'juniors':
      return staff.filter(s => notAway(s) && !isSeniorRank(s.rank, rankRows));
    case 'custom': {
      const ranks = a.ranks || [];
      const inRanks = staff.filter(s => ranks.length === 0 || ranks.includes(s.rank));
      if (a.scope === 'people') {
        const picked = new Set(a.staffIds || []);
        return inRanks.filter(s => picked.has(s.staff_id));
      }
      if (a.scope === 'working') return inRanks.filter(s => notAway(s) && working(s));
      return inRanks.filter(notAway);
    }
    case 'on_shift':
    default:
      return staff.filter(s => notAway(s) && working(s));
  }
}

// Night-shift people get the morning email but not the phone ping: they're
// likely asleep. A night shift ends at or before it starts (22:00-08:00)
// or starts from 18:00. nightStaffIds: everyone coming off a night that
// morning (yesterday's overnight shifts) or on a night that day, unless
// they also have a day shift that day. assignments: { staff_id, date,
// shifts: { start_time, end_time } }.
export const isNightShift = (shift) => {
  const start = (shift?.start_time || '').slice(0, 5);
  const end = (shift?.end_time || '').slice(0, 5);
  if (!start || !end) return false;
  return end <= start || start >= '18:00';
};

export function nightStaffIds(assignments, date) {
  const night = new Set();
  const day = new Set();
  for (const a of assignments) {
    const overnight = a.shifts && (a.shifts.end_time || '').slice(0, 5) <= (a.shifts.start_time || '').slice(0, 5);
    if (a.date === date) (isNightShift(a.shifts) ? night : day).add(a.staff_id);
    else if (a.date < date && overnight) night.add(a.staff_id);
  }
  return new Set([...night].filter(id => !day.has(id)));
}

// A short description for cards and settings: "Juniors",
// "Registrar, PHO · working that day", "3 people".
export function audienceLabel(audience) {
  const a = audience || DEFAULT_AUDIENCE;
  if (a.mode !== 'custom') return AUDIENCE_MODES.find(m => m.mode === a.mode)?.label || 'Everyone on shift';
  if (a.scope === 'people') {
    const n = (a.staffIds || []).length;
    return `${n} ${n === 1 ? 'person' : 'people'}`;
  }
  const ranks = (a.ranks || []).length ? a.ranks.join(', ') : 'All ranks';
  return a.scope === 'working' ? `${ranks} · working that day` : ranks;
}

// When the phone ping and the morning email are due, in minutes after
// midnight. The email goes at 08:00; for a meeting starting before 08:30
// it goes at 07:00, or half an hour before if it's earlier still. null =
// that reminder is off. Either is sent any time from then until the
// meeting starts (so a run that's a minute late still sends it).
export const MORNING_EMAIL_AT = 8 * 60;
export const EARLY_EMAIL_AT = 7 * 60;

export function reminderTimes(meeting) {
  const [h, m] = (meeting.start_time || '00:00').split(':').map(Number);
  const start = h * 60 + m;
  const push = meeting.push_minutes_before == null ? null : Math.max(0, start - meeting.push_minutes_before);
  let email = null;
  if (meeting.email_morning) {
    email = start < MORNING_EMAIL_AT + 30 ? Math.max(0, Math.min(EARLY_EMAIL_AT, start - 30)) : MORNING_EMAIL_AT;
  }
  return { start, push, email };
}

// Which reminders are due at `minutes` past midnight (on the meeting's day).
export function dueReminders(meeting, minutes) {
  const { start, push, email } = reminderTimes(meeting);
  const due = [];
  if (push != null && minutes >= push && minutes <= start) due.push('push');
  if (email != null && minutes >= email && minutes <= start) due.push('email');
  return due;
}
