import { missingRolesForCard, classifyDayStatus } from './volunteerUtils';

describe('missingRolesForCard', () => {
  test('an empty ordinary card can be offered as either role', () => {
    expect(missingRolesForCard({ requiresBoth: false, requiredGrade: null, filledRoles: new Set() })).toEqual(['consultant', 'registrar']);
  });

  test('an ordinary card with anyone on it needs nothing', () => {
    expect(missingRolesForCard({ requiresBoth: false, requiredGrade: null, filledRoles: new Set(['registrar']) })).toEqual([]);
  });

  test('a requires-both location needs whichever role is missing', () => {
    expect(missingRolesForCard({ requiresBoth: true, requiredGrade: null, filledRoles: new Set(['consultant']) })).toEqual(['registrar']);
  });

  test('a graded card only needs its grade role', () => {
    expect(missingRolesForCard({ requiresBoth: false, requiredGrade: 'smo', filledRoles: new Set() })).toEqual(['consultant']);
    expect(missingRolesForCard({ requiresBoth: false, requiredGrade: 'intern', filledRoles: new Set() })).toEqual(['registrar']);
    expect(missingRolesForCard({ requiresBoth: false, requiredGrade: 'intern', filledRoles: new Set(['registrar']) })).toEqual([]);
  });
});

describe('classifyDayStatus', () => {
  const base = { requiredCount: 2, unofferedGapCount: 0, volunteerCount: 0, openOfferCount: 0, hasAnyOnCall: true, missingOnCallCount: 0 };

  test('nothing at all is none', () => {
    expect(classifyDayStatus({ ...base, requiredCount: 0, hasAnyOnCall: false })).toBe('none');
  });

  test('an unoffered gap is red, even with volunteers elsewhere', () => {
    expect(classifyDayStatus({ ...base, unofferedGapCount: 1, volunteerCount: 1, openOfferCount: 1 })).toBe('red');
  });

  test('a volunteer waiting beats offered', () => {
    expect(classifyDayStatus({ ...base, volunteerCount: 1, openOfferCount: 2 })).toBe('volunteer');
  });

  test('offered with nobody volunteering yet', () => {
    expect(classifyDayStatus({ ...base, openOfferCount: 1, missingOnCallCount: 1 })).toBe('offered');
  });

  test('covered but on-call short is orange, otherwise green', () => {
    expect(classifyDayStatus({ ...base, missingOnCallCount: 1 })).toBe('orange');
    expect(classifyDayStatus(base)).toBe('green');
  });
});
