import { jobForCard, placeMismatch, layOutCard, dayConflict, isAdminJob, daysWorked, intervalOn, intervalsOverlap, groupUnconverted, bestJobForNewCard, jobForImportedShift } from './plannerUtils';

const ranks = [
  { rank: 'SMO', requires_supervision: false },
  { rank: 'Registrar', requires_supervision: true },
];
const SKILL_ENDO = 'skill-endo';
const smo = { staff_id: 'smo', rank: 'SMO', advanced_skills: [SKILL_ENDO] };
const smoNoSkill = { staff_id: 'smo2', rank: 'SMO', advanced_skills: [] };
const reg = { staff_id: 'reg', rank: 'Registrar', advanced_skills: [] };
const staffById = new Map([smo, smoNoSkill, reg].map(s => [s.staff_id, s]));

const edDay = { job_type_id: 'edday', location_id: 'ed', activity_id: 'edcover', start_time: '08:00:00', end_time: '18:00:00' };
const edNight = { job_type_id: 'ednight', location_id: 'ed', activity_id: 'edcover', start_time: '22:00:00', end_time: '08:00:00' };
const endo = { job_type_id: 'endo', location_id: 'th', activity_id: 'endo', start_time: '08:00', end_time: '12:00' };
const jobs = [edDay, edNight, endo];

const places = [
  { place_id: 'p-endoscopist', job_type_id: 'endo', role: 'Endoscopist', kind: 'either', grade: 'senior', required_advanced_skills: [SKILL_ENDO], min_count: 1, sort_order: 0 },
  { place_id: 'p-anaes', job_type_id: 'endo', role: 'Anaesthetist', kind: 'staff', grade: 'senior', required_advanced_skills: [], min_count: 1, sort_order: 1 },
];

describe('jobForCard', () => {
  it('uses the stored job, else matches location, activity and hours', () => {
    expect(jobForCard({ job_type_id: 'endo' }, jobs)).toBe(endo);
    expect(jobForCard({ location_id: 'ed', activity_id: 'edcover', start_time: '22:00', end_time: '08:00:00' }, jobs)).toBe(edNight);
    expect(jobForCard({ location_id: 'ed', activity_id: 'edcover', start_time: '10:00', end_time: '20:00' }, jobs)).toBeNull();
  });
});

describe('placeMismatch', () => {
  it('checks visitor-only, grade and skills', () => {
    expect(placeMismatch({ kind: 'visitor' }, smo, ranks)).toMatch(/Visitors/);
    expect(placeMismatch(places[1], reg, ranks)).toMatch(/senior/);
    expect(placeMismatch(places[0], smoNoSkill, ranks)).toMatch(/skill/);
    expect(placeMismatch(places[0], smo, ranks)).toBeNull();
    // Anyone can fill a junior place — e.g. an advanced trainee (no
    // supervision needed) in the RMO place.
    expect(placeMismatch({ kind: 'staff', grade: 'junior' }, smo, ranks)).toBeNull();
    expect(placeMismatch({ kind: 'staff', grade: 'junior' }, reg, ranks)).toBeNull();
  });

  it('treats an unknown rank as junior', () => {
    expect(placeMismatch(places[1], { rank: 'Mystery' }, ranks)).toMatch(/senior/);
  });
});

describe('layOutCard', () => {
  const card = { theatre_activity_id: 'c1' };

  it('fits bookings without a place into places they qualify for; the rest are extras', () => {
    const assigns = [
      { assignment_id: 'a1', staff_id: 'smo2' }, // no endo skill → anaesthetist place
      { assignment_id: 'a2', staff_id: 'smo' }, // → endoscopist place
      { assignment_id: 'a3', staff_id: 'reg' }, // junior → extra
    ];
    const out = layOutCard(card, endo, places, assigns, [], staffById, ranks);
    expect(out.places[0].slots[0].assignment.assignment_id).toBe('a2');
    expect(out.places[1].slots[0].assignment.assignment_id).toBe('a1');
    expect(out.extras.map(a => a.assignment_id)).toEqual(['a3']);
    expect(out).toMatchObject({ filled: 2, needed: 2 });
  });

  it('puts a visitor in their slot and respects place_id', () => {
    const out = layOutCard(card, endo, places, [{ assignment_id: 'a1', staff_id: 'smo', place_id: 'p-anaes' }], [{ place_id: 'p-endoscopist', slot: 0, name: 'Dr Visit' }], staffById, ranks);
    expect(out.places[0].slots[0].visitor.name).toBe('Dr Visit');
    expect(out.places[1].slots[0].assignment.assignment_id).toBe('a1');
    expect(out.filled).toBe(2);
  });

  it('fits a senior into a senior place before a junior one, but lets them take a junior place', () => {
    const rmoFirst = [
      { place_id: 'p-rmo', job_type_id: 'endo', role: 'RMO', kind: 'staff', grade: 'junior', required_advanced_skills: [], min_count: 1, sort_order: 0 },
      places[1],
    ];
    const out = layOutCard(card, endo, rmoFirst, [{ assignment_id: 'a1', staff_id: 'smo' }, { assignment_id: 'a2', staff_id: 'smo2' }], [], staffById, ranks);
    expect(out.places[1].slots[0].assignment.assignment_id).toBe('a1');
    expect(out.places[0].slots[0].assignment.assignment_id).toBe('a2');
    expect(out.extras).toHaveLength(0);
  });

  it('a card with no job has no places — everyone is an extra', () => {
    const out = layOutCard(card, null, places, [{ assignment_id: 'a1', staff_id: 'smo' }], [], staffById, ranks);
    expect(out).toMatchObject({ places: [], needed: 0 });
    expect(out.extras).toHaveLength(1);
  });
});

describe('isAdminJob', () => {
  it('matches admin or non-clinical in any of the names', () => {
    expect(isAdminJob('Admin', 'Clinic', 'Medical Clinic')).toBe(true);
    expect(isAdminJob(null, 'Non-clinical', 'Teaching')).toBe(true);
    expect(isAdminJob('Theatre AM', 'General Theatre', 'General Surgery')).toBe(false);
    expect(isAdminJob('Administration desk')).toBe(false);
  });
});

describe('dayConflict', () => {
  const base = { staffId: 'smo', dateStr: '2026-10-20', startTime: '08:00', endTime: '12:00', cardId: 'new', unavailable: [] };

  it('flags leave, being on the card already, and clashing hours', () => {
    expect(dayConflict({ ...base, assignments: [], unavailable: [{ staff_id: 'smo', date: '2026-10-20' }] })).toBe('Unavailable');
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'new', shifts: { start_time: '08:00', end_time: '12:00' } }] })).toMatch(/Already/);
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'x', shifts: { start_time: '10:00', end_time: '18:00' } }] })).toMatch(/Busy/);
  });

  it('lets Admin overlap other work, both ways, but not leave or a double booking', () => {
    const theatre = { staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'x', shifts: { start_time: '08:00', end_time: '12:00' } };
    expect(dayConflict({ ...base, assignments: [theatre], clashFree: true })).toBeNull();
    expect(dayConflict({ ...base, assignments: [theatre], isClashFree: a => a.theatre_activity_id === 'x' })).toBeNull();
    expect(dayConflict({ ...base, assignments: [], unavailable: [{ staff_id: 'smo', date: '2026-10-20' }], clashFree: true })).toBe('Unavailable');
    expect(dayConflict({ ...base, assignments: [{ ...theatre, theatre_activity_id: 'new' }], clashFree: true })).toMatch(/Already/);
  });

  it('allows back-to-back jobs and an AM then PM day', () => {
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'x', shifts: { start_time: '12:00', end_time: '17:00' } }] })).toBeNull();
  });

  it("sees last night's shift running into this morning", () => {
    const night = { staff_id: 'smo', date: '2026-10-19', theatre_activity_id: 'n', shifts: { start_time: '22:00', end_time: '08:30' } };
    expect(dayConflict({ ...base, assignments: [night] })).toMatch(/Busy/);
  });

  it('ignores on-call rows', () => {
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', on_call: true, theatre_activity_id: 'x', shifts: { start_time: '08:00', end_time: '18:00' } }] })).toBeNull();
  });
});

describe('helpers', () => {
  it('overnight intervals and overlap', () => {
    const n = intervalOn('2026-10-20', '22:00', '08:00');
    expect(n.end - n.start).toBe(600);
    expect(intervalsOverlap(n, intervalOn('2026-10-21', '07:00', '09:00'))).toBe(true);
  });

  it('counts each worked day once, bookings and on-call together', () => {
    const a = [{ staff_id: 's', date: '2026-10-20' }, { staff_id: 's', date: '2026-10-20' }, { staff_id: 's', date: '2026-10-19' }];
    const d = [{ staff_id: 's', date: '2026-10-21' }];
    expect(daysWorked('s', '2026-10-20', '2026-10-26', a, d)).toBe(2);
  });
});

describe('groupUnconverted', () => {
  const locations = [{ location_id: 'ed', name: 'Emergency' }, { location_id: 'th', name: 'Theatre' }, { location_id: 'w1', name: 'Ward 1' }, { location_id: 'w2', name: 'Ward 2' }];
  const activities = [{ activity_id: 'edcover', name: 'ED Cover' }, { activity_id: 'ward', name: 'Ward Care Cover', abbreviation: 'Ward' }, { activity_id: 'endo', name: 'Endoscopy' }];

  it('groups by location, activity and exact hours; points exact matches at their job', () => {
    const cards = [
      { theatre_activity_id: 'c1', date: '2026-10-20', location_id: 'ed', activity_id: 'edcover', start_time: '08:00:00', end_time: '18:00:00' },
      { theatre_activity_id: 'c2', date: '2026-10-21', location_id: 'ed', activity_id: 'edcover', start_time: '08:00', end_time: '18:00' },
      { theatre_activity_id: 'c3', date: '2026-10-20', location_id: 'ed', activity_id: 'edcover', start_time: '22:00', end_time: '08:00' },
      { theatre_activity_id: 'c4', date: '2026-10-20', location_id: 'w1', activity_id: 'ward', start_time: '08:00', end_time: '18:00' },
      { theatre_activity_id: 'c5', date: '2026-10-20', location_id: 'w2', activity_id: 'ward', start_time: '08:00', end_time: '18:00' },
      { theatre_activity_id: 'done', date: '2026-10-20', location_id: 'th', activity_id: 'endo', start_time: '08:00', end_time: '12:00', job_type_id: 'endo' },
    ];
    const entries = [{ week_template_entry_id: 'e1', location_id: 'ed', activity_id: 'edcover', start_time: '08:00', end_time: '18:00' }];
    const groups = groupUnconverted(cards, entries, [{ ...edNight, name: 'ED Night' }], locations, activities);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({ cardIds: ['c1', 'c2'], entryIds: ['e1'], firstDate: '2026-10-20', lastDate: '2026-10-21', suggestedName: 'ED Cover Day', matchJobId: null });
    expect(groups.find(g => g.cardIds.includes('c3')).matchJobId).toBe('ednight');
    // Same activity at two wards → the location goes in the name.
    expect(groups.find(g => g.cardIds.includes('c4')).suggestedName).toBe('Ward 1 Ward Day');
  });

  it('never suggests a name that is already taken', () => {
    const cards = [{ theatre_activity_id: 'c1', date: '2026-10-20', location_id: 'ed', activity_id: 'edcover', start_time: '08:00', end_time: '18:00' }];
    const [g] = groupUnconverted(cards, [], [{ ...edNight, name: 'ED Cover Day' }], locations, activities);
    expect(g.suggestedName).toBe('ED Cover Day 08:00–18:00');
  });
});

describe('bestJobForNewCard', () => {
  const card = (start, end, loc = 'ed', act = 'edcover') => ({ location_id: loc, activity_id: act, start_time: start, end_time: end });

  it('prefers exact hours, else the most overlap at the same location and activity', () => {
    expect(bestJobForNewCard(card('22:00', '08:00'), jobs)).toBe(edNight);
    expect(bestJobForNewCard(card('07:00', '17:00'), jobs)).toBe(edDay); // ED early
    expect(bestJobForNewCard(card('20:00', '06:00'), jobs)).toBe(edNight);
    expect(bestJobForNewCard(card('04:00', '09:00'), jobs)).toBe(edNight); // tail of last night's job
  });

  it('sends every ED time on the Innisfail sheet to its own job', () => {
    const job = (id, start, end) => ({ job_type_id: id, location_id: 'ed', activity_id: 'edcover', start_time: `${start}:00`, end_time: `${end}:00` });
    const day = job('day', '08:00', '18:00');
    const edl = job('edl', '10:30', '21:00');
    const evening = job('evening', '13:00', '23:00');
    const night = job('night', '22:30', '08:30');
    const edJobs = [edl, evening, night, day]; // order mustn't matter
    expect(bestJobForNewCard(card('08:00', '18:00'), edJobs)).toBe(day); // "ED", "Day 0800 -1800 ED"
    expect(bestJobForNewCard(card('10:30', '21:00'), edJobs)).toBe(edl); // "EDL + OC", "Afternoon 1030-2100"
    expect(bestJobForNewCard(card('10:30', '20:30'), edJobs)).toBe(edl); // intern "ED 1030-2030"
    expect(bestJobForNewCard(card('13:00', '23:00'), edJobs)).toBe(evening); // "Evening 1300-2300"
    expect(bestJobForNewCard(card('22:30', '08:30'), edJobs)).toBe(night); // "Night 2230 - 0830"
    expect(bestJobForNewCard(card('12:30', '18:00'), edJobs)).toBe(day); // PM half of "Ward 2/ED" — ties EDL on overlap
    expect(bestJobForNewCard(card('09:00', '12:00'), edJobs)).toBe(day); // AM half of "ED/ObsC"
  });

  it('puts interns in the intern jobs and keeps everyone else out of them', () => {
    const job = (id, name, start, end) => ({ job_type_id: id, name, location_id: 'ed', activity_id: 'edcover', start_time: `${start}:00`, end_time: `${end}:00` });
    const internDay = job('iday', 'ED Intern Day', '08:00', '18:00');
    const internLate = job('ilate', 'ED Intern Late', '10:30', '20:30');
    const day = job('day', 'ED Day', '08:00', '18:00');
    const edl = job('edl', 'EDL', '10:30', '21:00');
    const night = job('night', 'ED Night', '22:30', '08:30');
    const edJobs = [internDay, internLate, day, edl, night];
    expect(jobForImportedShift(card('08:00', '18:00'), edJobs, true)).toBe(internDay);
    expect(jobForImportedShift(card('10:30', '20:30'), edJobs, true)).toBe(internLate);
    expect(jobForImportedShift(card('22:30', '08:30'), edJobs, true)).toBe(night); // no intern job — the usual one
    expect(jobForImportedShift(card('08:00', '18:00'), edJobs, false)).toBe(day);
    expect(jobForImportedShift(card('10:30', '20:30'), edJobs, false)).toBe(edl);
  });

  it('never crosses to another location or activity, and ignores no-overlap', () => {
    expect(bestJobForNewCard(card('08:00', '12:00', 'w1'), jobs)).toBeNull();
    expect(bestJobForNewCard(card('13:00', '17:00', 'th', 'endo'), jobs)).toBeNull();
  });
});
