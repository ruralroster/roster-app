import { jobForCard, placeMismatch, layOutCard, dayConflict, daysWorked, intervalOn, intervalsOverlap } from './plannerUtils';

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
    expect(placeMismatch({ kind: 'staff', grade: 'junior' }, smo, ranks)).toMatch(/Junior/);
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

  it('a card with no job has no places — everyone is an extra', () => {
    const out = layOutCard(card, null, places, [{ assignment_id: 'a1', staff_id: 'smo' }], [], staffById, ranks);
    expect(out).toMatchObject({ places: [], needed: 0 });
    expect(out.extras).toHaveLength(1);
  });
});

describe('dayConflict', () => {
  const base = { staffId: 'smo', dateStr: '2026-10-20', startTime: '08:00', endTime: '12:00', cardId: 'new', unavailable: [] };

  it('flags leave, being on the card already, and clashing hours', () => {
    expect(dayConflict({ ...base, assignments: [], unavailable: [{ staff_id: 'smo', date: '2026-10-20' }] })).toBe('Unavailable');
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'new', shifts: { start_time: '08:00', end_time: '12:00' } }] })).toMatch(/Already/);
    expect(dayConflict({ ...base, assignments: [{ staff_id: 'smo', date: '2026-10-20', theatre_activity_id: 'x', shifts: { start_time: '10:00', end_time: '18:00' } }] })).toMatch(/Busy/);
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
