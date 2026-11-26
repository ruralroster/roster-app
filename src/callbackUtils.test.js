import { findActiveOnCalls, findOvertimeShifts, overtimeStartMode, variationLabel, onCallWindow, fatigueReturnTime, formatElapsed, formatDuration, buildCallbackNoteText, validateCallTimes, toDateTimeLocalValue } from './callbackUtils';

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

describe('findActiveOnCalls', () => {
  const assignments = [{ date: '2026-10-13', duty_type: 'anaes' }];

  it('matches at 2am the morning after an overnight on-call started', () => {
    const result = findActiveOnCalls(assignments, dutyTypes, at('2026-10-14T02:00:00'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2026-10-13', duty_type: 'anaes', label: 'Anaesthetics On-Call' });
  });

  it('returns every slot someone is on call for at once, e.g. ED + Anaesthetics', () => {
    const types = [...dutyTypes, { key: 'ed', label: 'ED On-Call', counts_as_on_call: true, start_time: '17:00', end_time: '08:00' }];
    const result = findActiveOnCalls([...assignments, { date: '2026-10-13', duty_type: 'ed' }], types, at('2026-10-14T02:00:00'));
    expect(result.map(r => r.label)).toEqual(['Anaesthetics On-Call', 'ED On-Call']);
  });

  it('does not match before the window starts or after it ends', () => {
    expect(findActiveOnCalls(assignments, dutyTypes, at('2026-10-13T20:59:00'))).toEqual([]);
    expect(findActiveOnCalls(assignments, dutyTypes, at('2026-10-14T08:00:00'))).toEqual([]);
  });

  it('ignores duty types not counted as on call, or with no times', () => {
    expect(findActiveOnCalls([{ date: '2026-10-14', duty_type: 'am_coord' }], dutyTypes, at('2026-10-14T09:00:00'))).toEqual([]);
    expect(findActiveOnCalls([{ date: '2026-10-14', duty_type: 'no_times' }], dutyTypes, at('2026-10-14T09:00:00'))).toEqual([]);
  });

  it('does not match someone not on call', () => {
    expect(findActiveOnCalls([], dutyTypes, at('2026-10-14T02:00:00'))).toEqual([]);
  });
});

describe('findOvertimeShifts', () => {
  const day = { name: 'Morning', start_time: '08:00:00', end_time: '17:00:00' };
  const rows = [
    { date: '2026-10-14', shift_id: 's1', shifts: day },
    { date: '2026-10-14', shift_id: 's1', shifts: day }, // second session row of the same shift
  ];

  it('is live from 30 min before the shift ends to 4 h after, once per shift', () => {
    expect(findOvertimeShifts(rows, [], at('2026-10-14T16:29:00'))).toEqual([]);
    expect(findOvertimeShifts(rows, [], at('2026-10-14T16:30:00'))).toHaveLength(1);
    expect(findOvertimeShifts(rows, [], at('2026-10-14T20:59:00'))[0]).toMatchObject({ shift_id: 's1', label: 'Morning' });
    expect(findOvertimeShifts(rows, [], at('2026-10-14T21:00:00'))).toEqual([]);
  });

  it("handles a night shift ending the next morning", () => {
    const night = [{ date: '2026-10-13', shift_id: 'n', shifts: { name: 'Night', start_time: '22:00', end_time: '08:00' } }];
    expect(findOvertimeShifts(night, [], at('2026-10-14T09:00:00'))).toHaveLength(1);
  });

  it('skips on-call rows — those get Callback instead', () => {
    expect(findOvertimeShifts(rows, ['s1'], at('2026-10-14T17:00:00'))).toEqual([]);
    expect(findOvertimeShifts([{ ...rows[0], on_call: true }], [], at('2026-10-14T17:00:00'))).toEqual([]);
  });
});

describe('overtimeStartMode', () => {
  const end = at('2026-10-14T17:00:00');

  it('waits for the shift end when tapped before it, asks when tapped after', () => {
    expect(overtimeStartMode(end, at('2026-10-14T16:40:00'))).toBe('scheduled');
    expect(overtimeStartMode(end, at('2026-10-14T17:00:00'))).toBe('ask');
    expect(overtimeStartMode(end, at('2026-10-14T18:15:00'))).toBe('ask');
  });
});

describe('variationLabel', () => {
  it('names the on-call slot or the shift', () => {
    expect(variationLabel({ kind: 'callback', duty_type: 'anaes' }, dutyTypes)).toBe('Callback — Anaesthetics On-Call');
    expect(variationLabel({ kind: 'overtime', shifts: { name: 'Morning' } }, dutyTypes)).toBe('Overtime — Morning');
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
      staffName: 'Dr Test', variationLabel: 'Callback — Anaesthetics On-Call',
      startedAt: at('2026-10-14T02:00:00'), endedAt: at('2026-10-14T02:45:00'),
      mrn: '1234567', surname: 'Smith', firstName: 'Jane',
    });
    expect(text).toContain('Type: Callback — Anaesthetics On-Call');
    expect(text).toContain('MRN: 1234567');
    expect(text).toContain('Patient: SMITH, Jane');
    expect(text).toContain('Duration: 45m');
  });
});

describe('editing call times', () => {
  const now = at('2026-10-14T09:00:00');

  it('accepts a sensible correction, including one crossing midnight', () => {
    expect(validateCallTimes('2026-10-13T23:40', '2026-10-14T01:15', now)).toBeNull();
  });

  it('rejects an end before the start, a future end, or a >24h call', () => {
    expect(validateCallTimes('2026-10-14T02:00', '2026-10-14T01:00', now)).toMatch(/end after/);
    expect(validateCallTimes('2026-10-14T08:00', '2026-10-14T10:00', now)).toMatch(/future/);
    expect(validateCallTimes('2026-10-12T02:00', '2026-10-14T03:00', now)).toMatch(/24 hours/);
    expect(validateCallTimes('', '2026-10-14T03:00', now)).toMatch(/both/);
  });

  it('formats a datetime-local value in local time', () => {
    expect(toDateTimeLocalValue(at('2026-10-14T02:05:00'))).toBe('2026-10-14T02:05');
  });
});

describe('variations to the ESO', () => {
  const { variationRef, esoSummaryLine, parseEsoSummaryLines, buildEsoEmail, mailtoHref, callbackNoteFilename } = require('./callbackUtils');
  const v = { ref: variationRef('4f2ka1b2-0000-0000-0000-000000000000'), kind: 'callback', label: 'ED on call', startedAt: '2026-11-24T22:40:00', endedAt: '2026-11-24T23:55:00', mrn: '1234567', surname: 'Citizen', firstName: 'Jane' };
  it('gives each variation a short reference', () => {
    expect(v.ref).toBe('V-4F2K');
  });
  it('writes a summary line the collator can read back', () => {
    const line = esoSummaryLine({ ...v, staffName: 'Ann Example' });
    expect(line).toBe('RSTAR|V-4F2K|Callback|2026-11-24|22:40|23:55|75|Ann Example|ED on call|1234567|CITIZEN|Jane');
    expect(parseEsoSummaryLines(`hello\n${line}\n`)[0]).toMatchObject({ ref: 'V-4F2K', minutes: 75, mrn: '1234567', surname: 'CITIZEN' });
  });
  it('builds the email with the patient details', () => {
    const { subject, body } = buildEsoEmail('Ann Example', [v]);
    expect(subject).toMatch(/V-4F2K: Callback/);
    expect(body).toMatch(/MRN 1234567 · CITIZEN, Jane/);
    expect(mailtoHref('eso@example.com', { subject, body })).toMatch(/^mailto:eso%40example\.com\?subject=/);
  });
  it('names the file so they sort together', () => {
    expect(callbackNoteFilename('2026-11-24T22:40:00', 'V-4F2K')).toBe('Rstar variation 2026-11-24 2240 V-4F2K.txt');
  });
});
