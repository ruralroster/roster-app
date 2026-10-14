import { findActiveOnCall, onCallWindow, fatigueReturnTime, formatElapsed, formatDuration, buildCallbackNoteText } from './callbackUtils';

const dutyTypes = [
  { key: 'anaes', label: 'Anaesthetics On-Call', counts_as_on_call: true, start_time: '21:00:00', end_time: '08:00:00' },
  { key: 'am_coord', label: 'AM Coordinator', counts_as_on_call: false, start_time: '08:00:00', end_time: '12:00:00' },
  { key: 'no_times', label: 'Untimed', counts_as_on_call: true, start_time: null, end_time: null },
];

const at = (s) => new Date(s);

describe('onCallWindow', () => {
  it('rolls an overnight window into the next day', () => {
    const { start, end } = onCallWindow('2026-10-13', '21:00:00', '08:00:00');
    expect(start).toEqual(at('2026-10-13T21:00:00'));
    expect(end).toEqual(at('2026-10-14T08:00:00'));
  });

  it('keeps a same-day window on the same day', () => {
    const { end } = onCallWindow('2026-10-13', '08:00', '17:00');
    expect(end).toEqual(at('2026-10-13T17:00:00'));
  });
});

describe('findActiveOnCall', () => {
  const assignments = [{ date: '2026-10-13', duty_type: 'anaes' }];

  it('matches at 2am the morning after an overnight on-call started', () => {
    const result = findActiveOnCall(assignments, dutyTypes, at('2026-10-14T02:00:00'));
    expect(result).toMatchObject({ date: '2026-10-13', duty_type: 'anaes', label: 'Anaesthetics On-Call' });
  });

  it('does not match before the window starts or after it ends', () => {
    expect(findActiveOnCall(assignments, dutyTypes, at('2026-10-13T20:59:00'))).toBeNull();
    expect(findActiveOnCall(assignments, dutyTypes, at('2026-10-14T08:00:00'))).toBeNull();
  });

  it('ignores duty types not counted as on call, or with no times', () => {
    expect(findActiveOnCall([{ date: '2026-10-14', duty_type: 'am_coord' }], dutyTypes, at('2026-10-14T09:00:00'))).toBeNull();
    expect(findActiveOnCall([{ date: '2026-10-14', duty_type: 'no_times' }], dutyTypes, at('2026-10-14T09:00:00'))).toBeNull();
  });

  it('does not match someone not on call', () => {
    expect(findActiveOnCall([], dutyTypes, at('2026-10-14T02:00:00'))).toBeNull();
  });
});

describe('fatigueReturnTime', () => {
  it('is 10 hours after the call ended — 2am → midday', () => {
    expect(fatigueReturnTime(at('2026-10-14T02:00:00'))).toEqual(at('2026-10-14T12:00:00'));
  });
});

describe('formatting', () => {
  it('formats the running timer and durations', () => {
    expect(formatElapsed(3723000)).toBe('01:02:03');
    expect(formatDuration(8 * 60000)).toBe('8m');
    expect(formatDuration(85 * 60000)).toBe('1h 25m');
  });

  it('puts the patient details only in the downloaded note', () => {
    const text = buildCallbackNoteText({
      staffName: 'Dr Test', dutyLabel: 'Anaesthetics On-Call',
      startedAt: at('2026-10-14T02:00:00'), endedAt: at('2026-10-14T02:45:00'),
      mrn: '1234567', surname: 'Smith', firstName: 'Jane',
    });
    expect(text).toContain('MRN: 1234567');
    expect(text).toContain('Patient: SMITH, Jane');
    expect(text).toContain('Duration: 45m');
  });
});
