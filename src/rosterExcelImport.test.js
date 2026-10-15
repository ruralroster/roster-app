import { applyPrimaryAllocation, applyCodeMappings, resolveShiftCode } from './rosterExcelImport';

const person = (rawShift) => ({ rawLabel: 'X', days: [{ date: 46307, rawShift, resolvedShift: resolveShiftCode(rawShift) }] });

describe('applyPrimaryAllocation', () => {
  test('a dual allocation becomes the first allocation, whole day', () => {
    const [p] = applyPrimaryAllocation([person('Ward 2/ED')], {}, resolveShiftCode);
    expect(p.days[0].resolvedShift.segments).toEqual([
      { location: 'Ward 2', activity: 'Ward Care Cover', start: '08:00', end: '18:00' },
    ]);
  });

  test('single codes and leave are left alone', () => {
    const people = [person('ED'), person('AL')];
    const out = applyPrimaryAllocation(people, {}, resolveShiftCode);
    expect(out[0].days[0]).toBe(people[0].days[0]);
    expect(out[1].days[0]).toBe(people[1].days[0]);
  });

  test('only the first half needs to be known', () => {
    const mapped = applyCodeMappings([person('OT/Endo2')], {}, resolveShiftCode);
    expect(mapped[0].days[0].resolvedShift.unmapped).toBe('Endo2');
    const [p] = applyPrimaryAllocation(mapped, {}, resolveShiftCode);
    expect(p.days[0].resolvedShift.segments[0].location).toBe('General Theatre');
  });
});
