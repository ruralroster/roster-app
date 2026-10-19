import { jobCategoryFor, jobBoxStyle, holdsOnCallDuty, shortOnCallLabel, jobCategoryRank, ON_CALL_BORDER, JOB_COLOURS } from './jobColours';

describe('jobCategoryFor', () => {
  test.each([
    ['Emergency', 'Emergency Department Cover', 'emergency'],
    ['Ward 1', 'Ward Care Cover', 'ward'],
    ['Ward 1 and 2 (Weekend Cover)', 'Ward Care Cover', 'ward'],
    ['General Theatre', 'General Surgery', 'theatre'],
    ['Endoscopy', 'Endoscopy', 'theatre'],
    ['Maternity', 'Ward Care Cover', 'maternity'],
    ['Clinic', 'Anaesthetics', 'theatre'],
    ['Clinic', 'Medical Clinic', null],
    ['Non-clinical', 'Admin', null],
  ])('%s / %s -> %s', (location, activity, expected) => {
    expect(jobCategoryFor(location, activity)).toBe(expected);
  });
});

describe('jobBoxStyle', () => {
  test('uses the roster colour for the job, with a magenta outline when on call', () => {
    expect(jobBoxStyle('emergency').backgroundColor).toBe(JOB_COLOURS.emergency.box);
    expect(jobBoxStyle('emergency').outline).toBeUndefined();
    expect(jobBoxStyle('emergency', true).backgroundColor).toBe(JOB_COLOURS.emergency.box);
    expect(jobBoxStyle('emergency', true).outline).toContain(ON_CALL_BORDER);
  });
});

describe('holdsOnCallDuty', () => {
  const dutyTypes = [
    { key: 'am_coordinator', label: 'Anaesthetics (AM)', counts_as_on_call: false },
    { key: 'pm_coordinator', label: 'Anaesthetics on-call (Night)', counts_as_on_call: true },
    { key: 'first_on_call', label: 'ED on call (Night)', counts_as_on_call: true },
  ];
  test('any on-call slot counts, whatever the job; day roles don\'t', () => {
    expect(holdsOnCallDuty(['first_on_call'], dutyTypes)).toBe(true);
    expect(holdsOnCallDuty(['pm_coordinator'], dutyTypes)).toBe(true);
    expect(holdsOnCallDuty(['am_coordinator'], dutyTypes)).toBe(false);
    expect(holdsOnCallDuty([], dutyTypes)).toBe(false);
  });
});

describe('shortOnCallLabel', () => {
  test.each([
    ['Anaesthetics On-call (night)', 'AN On-call'],
    ['ED On-call (Night)', 'ED On-call'],
    ['ED on call', 'ED On-call'],
    ['Obstetrics On Call', 'OB On-call'],
    ['PM Coordinator', 'PM Coordinator'],
    [undefined, undefined],
  ])('%s -> %s', (label, expected) => {
    expect(shortOnCallLabel(label)).toBe(expected);
  });
});

describe('jobCategoryRank', () => {
  test('follows JOB_COLOURS order, uncoloured last', () => {
    const sorted = [null, 'maternity', 'theatre', 'emergency', 'ward'].sort((a, b) => jobCategoryRank(a) - jobCategoryRank(b));
    expect(sorted).toEqual(['emergency', 'ward', 'theatre', 'maternity', null]);
  });
});
