import { buildFairness, activitySkillMap, dutyRankScore, formatFairShare, goesWithOnCall, exposureKey } from './fairness';

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
    expect(f.dutyScore('a', 'anaes_oc')).toBeCloseTo(1); // specialist: shared between a and b
    expect(f.dutyScore('c', 'anaes_oc')).toBeNull();
    expect(f.dutyScore('d', 'ed_oc')).toBeNull(); // not willing, never done it
    // All on call: 40 among a, b, c — 13.3 each. a did 15, b 10, c 15.
    expect(f.onCallScore('b')).toBeCloseTo(0.75);
    expect(f.onCallScore('d')).toBeNull();
    // ED on call is common: on what's left after anaesthetics on call. Fair
    // all-on-call share is 13.3 each; a and b have done 10 anaesthetics, so
    // 3.3 ED each is fair, c 13.3. a did 5 (over), b none (due), c 15.
    expect(f.dutyScore('a', 'ed_oc')).toBeCloseTo(1.5);
    expect(f.dutyScore('c', 'ed_oc')).toBeCloseTo(1.125);
    expect(dutyRankScore(f, 'b', 'ed_oc')).toBe(0);
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

describe('skilled places', () => {
  it("counts an ED AST's AST-place shifts apart from the ED everyone does", () => {
    // e1, e2 are ED ASTs: 30 AST-place ED each, plus 20 ordinary ED and 50 ward.
    // w1, w2 aren't: 25 ED and 75 ward. Ordinary ED and ward are then fair for all.
    const astEd = exposureKey('ed', { required_advanced_skills: ['edSkill'] });
    expect(astEd).toBe('ed#edSkill');
    const staff = [
      { staff_id: 'e1', fte: 1, advanced_skills: ['edSkill'] }, { staff_id: 'e2', fte: 1, advanced_skills: ['edSkill'] },
      { staff_id: 'w1', fte: 1 }, { staff_id: 'w2', fte: 1 },
    ];
    const f = buildFairness({
      staff,
      totalShiftsByStaff: totals(staff.map(s => [s.staff_id, 100])),
      statsByStaffActivity: stats([
        ['e1', astEd, 30], ['e1', 'ed', 14], ['e1', 'ward', 56], ['e2', astEd, 30], ['e2', 'ed', 14], ['e2', 'ward', 56],
        ['w1', 'ed', 20], ['w1', 'ward', 80], ['w2', 'ed', 20], ['w2', 'ward', 80],
      ]),
      activitySkills: new Map([['ed', []], ['ward', []]]),
    });
    expect(f.activityScore('e1', astEd)).toBeCloseTo(1);
    expect(f.activityScore('w1', astEd)).toBeNull();
    for (const id of ['e1', 'w1']) {
      expect(f.activityScore(id, 'ed')).toBeCloseTo(1);
      expect(f.activityScore(id, 'ward')).toBeCloseTo(1);
    }
  });
});

describe('a specialty anyone can cover (ED for an ED AST)', () => {
  // Two anaesthetic ASTs spend 4 of 10 shifts on anaesthetics; two obs
  // ASTs 9 of 10 on obstetrics (the service needs it). An ED AST and a
  // registrar with no AST do ED and wards, which anyone can do.
  const staff = [
    { staff_id: 'anA', fte: 1, advanced_skills: ['anaes'] },
    { staff_id: 'anB', fte: 1, advanced_skills: ['anaes'] },
    { staff_id: 'obA', fte: 1, advanced_skills: ['obs'] },
    { staff_id: 'obB', fte: 1, advanced_skills: ['obs'] },
    { staff_id: 'edA', fte: 1, advanced_skills: ['ed'] },
    { staff_id: 'reg', fte: 1 },
  ];
  const totals = new Map(staff.map(s => [s.staff_id, 10]));
  const activitySkills = new Map([['anaesthetics', ['anaes']], ['obstetrics', ['obs']], ['ed', []], ['ward', []]]);
  const stats = (edAst) => new Map(Object.entries({
    'anA|anaesthetics': 4, 'anA|ed': 3, 'anA|ward': 3,
    'anB|anaesthetics': 4, 'anB|ed': 3, 'anB|ward': 3,
    'obA|obstetrics': 9, 'obA|ward': 1,
    'obB|obstetrics': 9, 'obB|ward': 1,
    'edA|ed': edAst.ed, 'edA|ward': edAst.ward,
    'reg|ed': 5, 'reg|ward': 5,
  }).map(([k, count]) => [k, { count, lastDate: '2026-11-01' }]));
  const build = (edAst, specialtyActivities = new Map([['ed', ['ed']]])) => buildFairness({
    staff, totalShiftsByStaff: totals, statsByStaffActivity: stats(edAst), activitySkills, specialtyActivities,
  });

  it('benchmarks on the least service-bound specialty, not obstetrics', () => {
    expect(build({ ed: 7, ward: 3 }).astBenchmark).toMatchObject({ skill: 'anaes', share: 0.4 });
  });

  it('counts the ED AST\'s ED up to that share as specialist time, so their ward share matches an anaesthetic AST\'s', () => {
    const f = build({ ed: 7, ward: 3 });
    expect(f.astTime('edA')).toEqual({ done: 7, quota: 4 });
    expect(f.activityScore('edA', 'ward')).toBeCloseTo(f.activityScore('anA', 'ward'));
    expect(f.activityScore('edA', 'ed')).toBeCloseTo(f.activityScore('anA', 'ed'));
  });

  it('without the setting, the ED AST looks ahead on ED and behind on wards', () => {
    const f = build({ ed: 7, ward: 3 }, new Map());
    expect(f.activityScore('edA', 'ed')).toBeGreaterThan(f.activityScore('reg', 'ed'));
    expect(f.activityScore('edA', 'ward')).toBeLessThan(f.activityScore('anA', 'ward'));
  });

  it('puts the ED AST first for ED while they\'re under their share', () => {
    const f = build({ ed: 2, ward: 8 });
    expect(f.activityScore('edA', 'ed')).toBeCloseTo(-0.5);
    expect(f.activityScore('edA', 'ed')).toBeLessThan(f.activityScore('reg', 'ed'));
    expect(formatFairShare(f.activityScore('edA', 'ed'))).toBe('AST time due (50% of their share)');
  });
});
