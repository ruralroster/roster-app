import { suggestFill, patternProblem, shiftsByPerson, stretches } from './autoFill';

const DAY = 'shift-day';
const NIGHT = 'shift-night';
const OFF = 'shift-off';
const rankRows = [{ rank: 'SMO', requires_supervision: false }, { rank: 'RMO', requires_supervision: true }];

const person = (id, extra = {}) => ({ staff_id: id, name: id, rank: 'SMO', fte: 1, advanced_skills: [], active: true, ...extra });
const card = (id, date, extra = {}) => ({
  theatre_activity_id: id, date, activity_id: 'theatre', location_id: 'loc', shift_id: DAY,
  start_time: '08:00', end_time: '17:00', ...extra,
});
const place = (id, extra = {}) => ({ place_id: id, job_type_id: 'job', role: 'Doctor', grade: 'any', kind: 'staff', min_count: 1, required_advanced_skills: [], ...extra });
const slot = (c, p = place('p')) => ({ key: `${c.theatre_activity_id}|${p.place_id}|0`, card: c, job: { job_type_id: 'job' }, place: p });

const ctxFor = (staff, extra = {}) => ({
  staff, rankRows, todayStr: '2026-11-01',
  assignments: [], unavailable: [], bookings: [], rules: [], offShiftId: OFF,
  exposure: { staff, totalShiftsByStaff: new Map(), statsByStaffActivity: new Map(), activitySkills: new Map() },
  isAdminCard: () => false, sameJob: (a, b) => a.activity_id === b.activity_id, cardLabel: () => 'a job',
  cardOf: () => null, activityKeyOf: () => null, isClashFree: () => false,
  ...extra,
});
const booked = (staffId, date, shiftId = DAY, start = '08:00', end = '17:00') =>
  ({ staff_id: staffId, date, shift_id: shiftId, on_call: false, leave_code: null, theatre_activity_id: `x-${date}`, shifts: { start_time: start, end_time: end } });

describe('stretches', () => {
  it('counts separate runs of days', () => {
    expect(stretches(['2026-11-02', '2026-11-03', '2026-11-06'])).toBe(2);
    expect(stretches(['2026-11-02', '2026-11-03', '2026-11-04'])).toBe(1);
    expect(stretches([])).toBe(0);
  });
});

describe('patternProblem', () => {
  // A day straight after a night is blocked.
  const rules = [{ shift_1_id: null, shift_2_id: null, shift_3_id: null, shift_4_id: null, shift_5_id: null, shift_6_id: NIGHT, shift_7_id: DAY, rule_action: 'BLOCK', description: 'No day after a night' }];
  it('blocks the day itself', () => {
    expect(patternProblem(rules, OFF, new Map([['2026-11-02', NIGHT]]), '2026-11-03', DAY)).toMatch(/No day after a night/);
    expect(patternProblem(rules, OFF, new Map([['2026-11-01', NIGHT]]), '2026-11-03', DAY)).toBeNull();
  });
  it('blocks a shift that breaks the rule for a later day', () => {
    expect(patternProblem(rules, OFF, new Map([['2026-11-04', DAY]]), '2026-11-03', NIGHT)).toMatch(/No day after a night/);
  });
  it("doesn't blame a new shift for a later day already breaking it", () => {
    const days = new Map([['2026-11-04', NIGHT], ['2026-11-05', DAY]]);
    expect(patternProblem(rules, OFF, days, '2026-11-02', DAY)).toBeNull();
  });
  it("doesn't count on call", () => {
    expect(shiftsByPerson([{ staff_id: 'a', date: '2026-11-02', shift_id: NIGHT, on_call: true }]).get('a')).toBeUndefined();
    expect(shiftsByPerson([{ staff_id: 'a', date: '2026-11-02', shift_id: NIGHT, on_call: false }]).get('a').get('2026-11-02')).toBe(NIGHT);
  });
  it('can count only BLOCK rules', () => {
    const warn = [{ ...rules[0], rule_action: 'WARN' }];
    expect(patternProblem(warn, OFF, new Map([['2026-11-02', NIGHT]]), '2026-11-03', DAY, ['BLOCK'])).toBeNull();
    expect(patternProblem(warn, OFF, new Map([['2026-11-02', NIGHT]]), '2026-11-03', DAY)).toMatch(/No day after/);
  });
});

describe('suggestFill', () => {
  it('fills the place fewest people can take first', () => {
    const staff = [person('alice', { advanced_skills: ['ortho'] }), person('bob')];
    const special = slot(card('c1', '2026-11-03'), place('ortho', { required_advanced_skills: ['ortho'] }));
    const general = slot(card('c2', '2026-11-03', { start_time: '07:00' }), place('gen'));
    const { drafts, unfilled } = suggestFill([general, special], ctxFor(staff));
    expect(unfilled).toEqual([]);
    expect(drafts.find(d => d.key === special.key).staffId).toBe('alice');
    expect(drafts.find(d => d.key === general.key).staffId).toBe('bob');
  });

  it('leaves a place nobody can take', () => {
    const staff = [person('rmo', { rank: 'RMO' })];
    const senior = slot(card('c1', '2026-11-03'), place('sen', { grade: 'senior' }));
    expect(suggestFill([senior], ctxFor(staff)).unfilled).toEqual([senior.key]);
  });

  it('keeps 10 hours between days', () => {
    const staff = [person('alice')];
    const early = slot(card('c1', '2026-11-03', { start_time: '07:00', end_time: '15:00' }));
    const ctx = ctxFor(staff, { assignments: [booked('alice', '2026-11-02', 'late', '14:00', '23:00')] });
    expect(suggestFill([early], ctx).unfilled).toEqual([early.key]);
  });

  it("doesn't take anyone past their FTE", () => {
    const staff = [person('half', { fte: 0.1 })]; // 8.8 hours a fortnight
    const shift = slot(card('c1', '2026-11-03'));
    expect(suggestFill([shift], ctxFor(staff)).unfilled).toEqual([shift.key]);
  });

  it('follows the shift pattern rules', () => {
    const staff = [person('alice')];
    const rules = [{ shift_1_id: null, shift_2_id: null, shift_3_id: null, shift_4_id: null, shift_5_id: null, shift_6_id: NIGHT, shift_7_id: DAY, rule_action: 'WARN', description: 'No day after a night' }];
    const shift = slot(card('c1', '2026-11-03', { start_time: '13:00', end_time: '17:00' }));
    const ctx = ctxFor(staff, { rules, bookings: [booked('alice', '2026-11-02', NIGHT, '22:00', '02:00')] });
    expect(suggestFill([shift], ctx).unfilled).toEqual([shift.key]);
  });

  it('keeps days together', () => {
    // Alice works Mon and Tue already; Bob works Thu. Wed and Fri need
    // someone each. Fairness alone could give Alice Fri and Bob Wed.
    const staff = [person('alice'), person('bob')];
    const wed = slot(card('wed', '2026-11-04'));
    const fri = slot(card('fri', '2026-11-06'));
    const assignments = [booked('alice', '2026-11-02'), booked('alice', '2026-11-03'), booked('bob', '2026-11-05')];
    const { drafts } = suggestFill([wed, fri], ctxFor(staff, { assignments, bookings: assignments }));
    expect(drafts.find(d => d.key === wed.key).staffId).toBe('alice');
    expect(drafts.find(d => d.key === fri.key).staffId).toBe('bob');
    expect(drafts.every(d => d.moved)).toBe(true);
  });
});
