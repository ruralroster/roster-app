import { jobCategoryFor, jobBoxStyle, isOnCallForCategory, ON_CALL_BOX, JOB_COLOURS } from './jobColours';

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
  test('uses the roster colour for the job, red when on call', () => {
    expect(jobBoxStyle('emergency').backgroundColor).toBe(JOB_COLOURS.emergency.box);
    expect(jobBoxStyle('emergency', true).backgroundColor).toBe(ON_CALL_BOX.background);
  });
});

describe('isOnCallForCategory', () => {
  const dutyTypes = [
    { key: 'ed_oncall', label: 'ED on call', counts_as_on_call: true },
    { key: 'anaes_oncall', label: 'Anaesthetics on call', counts_as_on_call: true },
  ];
  test('matches the duty to the card\'s job type', () => {
    expect(isOnCallForCategory('emergency', ['ed_oncall'], dutyTypes)).toBe(true);
    expect(isOnCallForCategory('emergency', ['anaes_oncall'], dutyTypes)).toBe(false);
    expect(isOnCallForCategory('theatre', ['anaes_oncall'], dutyTypes)).toBe(true);
    expect(isOnCallForCategory('ward', [], dutyTypes)).toBe(false);
  });
});
