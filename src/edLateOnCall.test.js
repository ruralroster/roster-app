import { isEdLateAssignment, edLateOnCallFor } from './edLateOnCall';

const DUTY_TYPES = [
  { key: 'am_coordinator', label: 'Anaesthetics (AM)', counts_as_on_call: false },
  { key: 'pm_coordinator', label: 'Anaesthetics on-call (Night)', counts_as_on_call: true },
  { key: 'first_on_call', label: 'ED on call (Night)', counts_as_on_call: true },
  { key: 'second_on_call', label: 'Obstetrics on-call (Night)', counts_as_on_call: true },
];

const assignment = (staffId, name, role, location, start, end) => ({
  staff_id: staffId, role, staff: { name }, locations: { name: location }, shifts: { start_time: start, end_time: end },
});
const tom = assignment('tom', 'Tom Newman', 'consultant', 'Emergency', '10:30:00', '21:00:00');

describe('isEdLateAssignment', () => {
  test('a consultant on the 10:30-21:00 Emergency shift', () => {
    expect(isEdLateAssignment(tom)).toBe(true);
  });
  test('not the ED day shift, a registrar evening, an intern late, or another location', () => {
    expect(isEdLateAssignment(assignment('a', 'A', 'consultant', 'Emergency', '08:00', '18:00'))).toBe(false);
    expect(isEdLateAssignment(assignment('b', 'B', 'registrar', 'Emergency', '13:00', '23:00'))).toBe(false);
    expect(isEdLateAssignment(assignment('c', 'C', 'registrar', 'Emergency', '10:30', '20:30'))).toBe(false);
    expect(isEdLateAssignment(assignment('d', 'D', 'consultant', 'Ward 1', '10:30', '21:00'))).toBe(false);
  });
});

describe('edLateOnCallFor', () => {
  test('nobody in the ED on-call slot: the ED late consultant is on call', () => {
    expect(edLateOnCallFor([tom], ['pm_coordinator'], DUTY_TYPES)).toEqual({
      dutyKey: 'first_on_call', dutyLabel: 'ED on call (Night)', staffId: 'tom', staffName: 'Tom Newman',
    });
  });
  test('the slot filled, no ED late, or two on it: nobody stands in', () => {
    expect(edLateOnCallFor([tom], ['first_on_call'], DUTY_TYPES)).toBeNull();
    expect(edLateOnCallFor([], [], DUTY_TYPES)).toBeNull();
    const other = assignment('ann', 'Ann', 'consultant', 'Emergency', '10:30', '21:00');
    expect(edLateOnCallFor([tom, other], [], DUTY_TYPES)).toBeNull();
  });
  test('one person on the ED late in two rows still counts once', () => {
    expect(edLateOnCallFor([tom, { ...tom }], [], DUTY_TYPES)?.staffId).toBe('tom');
  });
});
