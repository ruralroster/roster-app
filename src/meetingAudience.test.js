import fs from 'fs';
import path from 'path';
import { meetingRecipients, audienceLabel, reminderTimes, dueReminders, nightStaffIds, isNightShift } from './meetingAudience';

test('the Edge Function copy of meetingAudience.js matches exactly', () => {
  const here = fs.readFileSync(path.join(__dirname, 'meetingAudience.js'), 'utf8');
  const shared = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'meetingAudience.js'), 'utf8');
  expect(shared).toBe(here);
});

const rankRows = [
  { rank: 'Consultant', requires_supervision: false },
  { rank: 'SMO', requires_supervision: false },
  { rank: 'Registrar', requires_supervision: true },
  { rank: 'PHO', requires_supervision: true },
];
const staff = [
  { staff_id: 'c1', name: 'Cons One', rank: 'Consultant' },
  { staff_id: 's1', name: 'SMO One', rank: 'SMO' },
  { staff_id: 'r1', name: 'Reg One', rank: 'Registrar' },
  { staff_id: 'r2', name: 'Reg Two', rank: 'Registrar' },
  { staff_id: 'p1', name: 'PHO One', rank: 'PHO' },
];
const ctx = {
  staff,
  rankRows,
  workingIds: new Set(['c1', 'r1', 'p1']),
  awayIds: new Set(['r2']),
};
const ids = (audience) => meetingRecipients(audience, ctx).map(s => s.staff_id).sort();

describe('meetingRecipients', () => {
  test('everyone leaves out people away that day', () => {
    expect(ids({ mode: 'everyone' })).toEqual(['c1', 'p1', 'r1', 's1']);
  });
  test('on shift is only those working, and is the default', () => {
    expect(ids({ mode: 'on_shift' })).toEqual(['c1', 'p1', 'r1']);
    expect(ids(null)).toEqual(['c1', 'p1', 'r1']);
  });
  test('seniors and juniors include people not working', () => {
    expect(ids({ mode: 'seniors' })).toEqual(['c1', 's1']);
    expect(ids({ mode: 'juniors' })).toEqual(['p1', 'r1']);
  });
  test('custom: ranks, then all / working / specific people', () => {
    expect(ids({ mode: 'custom', ranks: ['Registrar', 'SMO'], scope: 'all' })).toEqual(['r1', 's1']);
    expect(ids({ mode: 'custom', ranks: ['Registrar', 'SMO'], scope: 'working' })).toEqual(['r1']);
    expect(ids({ mode: 'custom', ranks: [], scope: 'working' })).toEqual(['c1', 'p1', 'r1']);
  });
  test('people ticked by name get it even when away', () => {
    expect(ids({ mode: 'custom', ranks: ['Registrar'], scope: 'people', staffIds: ['r2', 'c1'] })).toEqual(['r2']);
  });
});

test('audienceLabel', () => {
  expect(audienceLabel({ mode: 'juniors' })).toBe('Juniors');
  expect(audienceLabel({ mode: 'custom', ranks: ['Registrar', 'PHO'], scope: 'working' })).toBe('Registrar, PHO · working that day');
  expect(audienceLabel({ mode: 'custom', ranks: [], scope: 'all' })).toBe('All ranks');
  expect(audienceLabel({ mode: 'custom', scope: 'people', staffIds: ['a'] })).toBe('1 person');
});

describe('reminder timing', () => {
  const m = (start_time, push_minutes_before = 10, email_morning = true) => ({ start_time, push_minutes_before, email_morning });

  test('push 10 minutes before; email at 08:00, or 07:00 for an early meeting', () => {
    expect(reminderTimes(m('12:30:00'))).toEqual({ start: 750, push: 740, email: 480 });
    expect(reminderTimes(m('08:00:00'))).toEqual({ start: 480, push: 470, email: 420 });
    expect(reminderTimes(m('06:45:00')).email).toBe(375);
    expect(reminderTimes(m('12:30:00', null, false))).toEqual({ start: 750, push: null, email: null });
  });

  test('due from its time until the meeting starts', () => {
    expect(dueReminders(m('12:30'), 479)).toEqual([]);
    expect(dueReminders(m('12:30'), 480)).toEqual(['email']);
    expect(dueReminders(m('12:30'), 741)).toEqual(['push', 'email']);
    expect(dueReminders(m('12:30'), 751)).toEqual([]);
  });
});

describe('night shifts', () => {
  const NIGHT = { start_time: '22:00:00', end_time: '08:00:00' };
  const EVENING = { start_time: '18:00:00', end_time: '23:59:00' };
  const DAY = { start_time: '08:00:00', end_time: '17:00:00' };

  test('isNightShift', () => {
    expect(isNightShift(NIGHT)).toBe(true);
    expect(isNightShift(EVENING)).toBe(true);
    expect(isNightShift(DAY)).toBe(false);
    expect(isNightShift(null)).toBe(false);
  });

  test('coming off last night or on tonight, unless also on a day shift', () => {
    const night = nightStaffIds([
      { staff_id: 'off', date: '2026-11-02', shifts: NIGHT },
      { staff_id: 'yday', date: '2026-11-02', shifts: DAY },
      { staff_id: 'tonight', date: '2026-11-03', shifts: NIGHT },
      { staff_id: 'both', date: '2026-11-03', shifts: NIGHT },
      { staff_id: 'both', date: '2026-11-03', shifts: DAY },
      { staff_id: 'day', date: '2026-11-03', shifts: DAY },
    ], '2026-11-03');
    expect([...night].sort()).toEqual(['off', 'tonight']);
  });
});
