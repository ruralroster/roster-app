import { applyPrimaryAllocation, applyCodeMappings, resolveShiftCode, extractRmoWeek, onCallKindsForDay } from './rosterExcelImport';

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

describe('suggestStaffMatches', () => {
  const { suggestStaffMatches } = require('./rosterExcelImport');
  const staff = [
    { staff_id: 'tom', name: 'Tom Newman' },
    { staff_id: 'rachel', name: 'Rachel Boland' },
    { staff_id: 'james', name: 'James Boland' },
    { staff_id: 'sally', name: 'Sally Barkla' },
  ];
  const ids = (label) => suggestStaffMatches(label, staff).map(s => s.staff_id);

  test('same surname and first initial', () => {
    expect(ids('Thomas Newman  ED')).toEqual(['tom']);
    expect(ids('Rach Boland Obstetrics')).toEqual(['rachel']);
  });
  test('same first name and surname initial', () => {
    expect(ids('Sally Barkley')).toEqual(['sally']);
  });
  test('an exact name, or someone else entirely, suggests nobody', () => {
    expect(ids('Tom Newman')).toEqual([]);
    expect(ids('Daniel Charles Anaesthetics')).toEqual([]);
    expect(ids('Newman')).toEqual([]);
  });
});

describe('extractRmoWeek on-call notes', () => {
  // Week block with its label column at 0 and Monday at column 1.
  const row = (label, ...cells) => [label, ...cells, ...Array(7 - cells.length).fill('')];
  const rows = [
    row('Week 1'),
    row('', '19/10/2026', '20/10/2026', '21/10/2026', '22/10/2026', '23/10/2026', '24/10/2026', '25/10/2026'),
    row('Anusheh Mubeen', 'Day 0800 - 1800 Maternity', 'Evening 1300-2300', '', '', 'ANC/Obs'),
    row('', 'Obs', '', '', '', 'Obs'),
    row('', 'Alex Parfitt MOB: 0400 000 000'),
    row('Alex Parfitt', 'Night 2230 - 0830'),
  ];

  it("reads the unlabelled notes row under a registrar as their on-call", () => {
    const [anusheh, alex] = extractRmoWeek(rows, 0, 1);
    expect(anusheh.days.map(onCallKindsForDay)).toEqual([['obs'], [], [], [], ['obs'], [], []]);
    expect(alex.rawLabel).toBe('Alex Parfitt');
    expect(alex.days.every(d => !d.rawOnCall)).toBe(true);
  });

  it("never takes the next person's contact line for notes", () => {
    const withContactBelow = [...rows.slice(0, 3), ...rows.slice(4)];
    const [anusheh] = extractRmoWeek(withContactBelow, 0, 1);
    expect(anusheh.days.every(d => !d.rawOnCall)).toBe(true);
  });
});
