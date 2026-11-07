import { buildFairness, activitySkillMap, dutyRankScore, formatFairShare, goesWithOnCall } from './fairness';

const stats = (rows) => new Map(rows.map(([staff, activity, count]) => [`${staff}|${activity}`, { count, lastDate: '2026-10-01' }]));
const totals = (rows) => new Map(rows);

describe('buildFairness', () => {
  it("takes a job only one person can do out of their figures", () => {
    // The only endoscopist is also an ED AST: 20 endoscopy, 40 ED, 40 ward.
    const staff = [
      { staff_id: 'endo', fte: 1, advanced_skills: ['endo', 'ed'] },
      { staff_id: 'ed1', fte: 1, advanced_skills: ['ed'] },
      { staff_id: 'ed2', fte: 1, advanced_skills: ['ed'] },
    ];
    const f = buildFairness({
      staff,
      totalShiftsByStaff: totals([['endo', 100], ['ed1', 100], ['ed2', 100]]),
      statsByStaffActivity: stats([
        ['endo', 'endoscopy', 20], ['endo', 'ed', 40], ['endo', 'ward', 40],
        ['ed1', 'ed', 50], ['ed1', 'ward', 50], ['ed2', 'ed', 50], ['ed2', 'ward', 50],
      ]),
      activitySkills: new Map([['endoscopy', ['endo']], ['ed', ['ed']], ['ward', []]]),
    });
    expect(f.soloOwner.get('endoscopy')).toBe('endo');
    expect(f.activityScore('endo', 'endoscopy')).toBeNull();
    expect(f.effectiveFte('endo')).toBeCloseTo(0.8);
    // Not behind on ED or ward once the endoscopy is allowed for.
    expect(f.activityScore('endo', 'ed')).toBeCloseTo(1);
    expect(f.activityScore('endo', 'ward')).toBeCloseTo(1);
    expect(f.activityScore('ed1', 'ed')).toBeCloseTo(1);
  });

  it('shares ward jobs on the time left after specialist work', () => {
    // Anaesthetic ASTs do 40% anaesthetics; ED ASTs 70% ED. Both are fair on ward.
    const staff = ['a1', 'a2', 'e1', 'e2'].map(id => ({ staff_id: id, fte: 1, advanced_skills: [id[0] === 'a' ? 'anaes' : 'ed'] }));
    const f = buildFairness({
      staff,
      totalShiftsByStaff: totals(staff.map(s => [s.staff_id, 100])),
      statsByStaffActivity: stats([
        ['a1', 'anaes', 40], ['a1', 'ward', 60], ['a2', 'anaes', 40], ['a2', 'ward', 60],
        ['e1', 'ed', 70], ['e1', 'ward', 30], ['e2', 'ed', 70], ['e2', 'ward', 30],
      ]),
      activitySkills: new Map([['anaes', ['anaes']], ['ed', ['ed']], ['ward', []]]),
    });
    for (const id of ['a1', 'a2', 'e1', 'e2']) expect(f.activityScore(id, 'ward')).toBeCloseTo(1);
    expect(f.activityScore('a1', 'anaes')).toBeCloseTo(1);
    expect(f.activityScore('e1', 'anaes')).toBeNull();
  });

  it('shares weekends by FTE among everyone', () => {
    const f = buildFairness({
      staff: [{ staff_id: 'full', fte: 1 }, { staff_id: 'half', fte: 0.5 }],
      totalShiftsByStaff: totals([['full', 100], ['half', 50]]),
      statsByStaffActivity: new Map(),
      weekendShiftsByStaff: new Map([['full', 20], ['half', 10]]),
    });
    expect(f.weekendScore('full')).toBeCloseTo(1);
    expect(f.weekendScore('half')).toBeCloseTo(1);
  });

  it('shares each on-call type among those who can do it, and all on call across the hospital', () => {
    const staff = [
      { staff_id: 'a', fte: 1, advanced_skills: ['anaes'] },
      { staff_id: 'b', fte: 1, advanced_skills: ['anaes'] },
      { staff_id: 'c', fte: 1, advanced_skills: [] },
      { staff_id: 'd', fte: 1, advanced_skills: [], on_call_willing: false },
    ];
    const f = buildFairness({
      staff,
      totalShiftsByStaff: totals(staff.map(s => [s.staff_id, 100])),
      statsByStaffActivity: new Map(),
      dutyTypes: [{ key: 'anaes_oc', required_advanced_skills: ['anaes'] }, { key: 'ed_oc', required_advanced_skills: [] }],
      dutyCounts: new Map([['a|anaes_oc', 10], ['b|anaes_oc', 10], ['a|ed_oc', 5], ['c|ed_oc', 15]]),
    });
    expect(f.dutyScore('a', 'anaes_oc')).toBeCloseTo(1);
    expect(f.dutyScore('c', 'anaes_oc')).toBeNull();
    expect(f.dutyScore('d', 'ed_oc')).toBeNull(); // not willing, never done it
    // All on call: 40 among a, b, c — 13.3 each. a did 15, b 10, c 15.
    expect(f.onCallScore('b')).toBeCloseTo(0.75);
    expect(f.onCallScore('d')).toBeNull();
    // ED on call among a, b, c: b has done none, so b first.
    expect(dutyRankScore(f, 'b', 'ed_oc')).toBeLessThan(dutyRankScore(f, 'a', 'ed_oc'));
  });
});

describe('activitySkillMap', () => {
  it("uses the activity's skills, or the skills every staff place on its jobs needs", () => {
    const map = activitySkillMap(
      [{ activity_id: 'endo', required_advanced_skills: ['e'] }, { activity_id: 'anaes' }, { activity_id: 'ed' }],
      [{ job_type_id: 'j1', activity_id: 'anaes' }, { job_type_id: 'j2', activity_id: 'ed' }],
      [
        { job_type_id: 'j1', kind: 'staff', required_advanced_skills: ['a'] },
        { job_type_id: 'j1', kind: 'visitor', required_advanced_skills: [] },
        { job_type_id: 'j2', kind: 'staff', required_advanced_skills: ['x'] },
        { job_type_id: 'j2', kind: 'staff', required_advanced_skills: [] },
      ],
    );
    expect(map.get('endo')).toEqual(['e']);
    expect(map.get('anaes')).toEqual(['a']);
    expect(map.get('ed')).toEqual([]);
  });
});

describe('formatFairShare', () => {
  it('reads as a multiple of fair share', () => {
    expect(formatFairShare(0.8)).toBe('0.80× fair share');
    expect(formatFairShare(null)).toBe('');
  });
});

describe('goesWithOnCall', () => {
  const dt = { lead_in_shift_ids: ['late'], follow_on_shift_ids: ['am'] };
  it('matches the shift leading in that day, or the one after it next day', () => {
    expect(goesWithOnCall(dt, 'me', '2026-11-02', [{ staff_id: 'me', date: '2026-11-02', shift_id: 'late' }])).toBe(true);
    expect(goesWithOnCall(dt, 'me', '2026-11-02', [{ staff_id: 'me', date: '2026-11-03', shift_id: 'am' }])).toBe(true);
    expect(goesWithOnCall(dt, 'me', '2026-11-02', [{ staff_id: 'me', date: '2026-11-03', shift_id: 'late' }])).toBe(false);
    expect(goesWithOnCall({}, 'me', '2026-11-02', [{ staff_id: 'me', date: '2026-11-02', shift_id: 'late' }])).toBe(false);
  });
});
