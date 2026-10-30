import { sickCallShiftsInWindow, describeSickCallShift } from './sickCallShifts';

const shift = (date, start, end, extra = {}) => ({
  assignment_id: `${date}-${start}`,
  date,
  locations: { name: 'Theatre 1' },
  shifts: start ? { name: 'AM', start_time: `${start}:00`, end_time: `${end}:00` } : null,
  ...extra,
});

describe('sickCallShiftsInWindow', () => {
  const now = new Date('2026-10-22T20:00:00');

  it("includes tomorrow morning's shift the evening before", () => {
    const result = sickCallShiftsInWindow([shift('2026-10-23', '08:00', '12:30')], now);
    expect(result.map(s => s.assignment.date)).toEqual(['2026-10-23']);
  });

  it('leaves out a shift starting more than 12 hours away', () => {
    expect(sickCallShiftsInWindow([shift('2026-10-23', '08:30', '17:00')], now)).toEqual([]);
    expect(sickCallShiftsInWindow([shift('2026-10-23', '21:00', '23:00')], now)).toEqual([]);
  });

  it('includes a shift exactly 12 hours away (8pm for an 8am start)', () => {
    expect(sickCallShiftsInWindow([shift('2026-10-23', '08:00', '17:00')], now)).toHaveLength(1);
  });

  it("leaves out a shift that's already finished", () => {
    expect(sickCallShiftsInWindow([shift('2026-10-22', '08:00', '17:00')], now)).toEqual([]);
  });

  it("includes an overnight shift that's still going", () => {
    const early = new Date('2026-10-23T02:00:00');
    const result = sickCallShiftsInWindow([shift('2026-10-22', '17:00', '08:00')], early);
    expect(result).toHaveLength(1);
  });

  it('prefers card times over shift times', () => {
    const a = shift('2026-10-23', '08:00', '12:30', { theatre_activities: { start_time: '22:00:00', end_time: '23:00:00' } });
    expect(sickCallShiftsInWindow([a], now)).toEqual([]);
  });

  it('counts an assignment with no times as its whole date', () => {
    expect(sickCallShiftsInWindow([shift('2026-10-23', null, null)], now)).toHaveLength(1);
    expect(sickCallShiftsInWindow([shift('2026-10-22', null, null)], now)).toHaveLength(1);
    expect(sickCallShiftsInWindow([shift('2026-10-21', null, null)], now)).toEqual([]);
  });

  it('skips leave and sorts soonest first', () => {
    const result = sickCallShiftsInWindow([
      shift('2026-10-23', '06:00', '07:30'),
      shift('2026-10-22', '22:00', '23:30'),
      shift('2026-10-23', '06:00', '07:30', { leave_code: 'AL', assignment_id: 'leave' }),
    ], now);
    expect(result.map(s => s.startTime)).toEqual(['22:00', '06:00']);
  });
});

describe('describeSickCallShift', () => {
  it('names the date, place, shift and times', () => {
    const [s] = sickCallShiftsInWindow([shift('2026-10-23', '08:00', '12:30')], new Date('2026-10-22T20:00:00'));
    expect(describeSickCallShift(s)).toBe('Fri, 23 Oct — Theatre 1, AM (08:00–12:30)');
  });
});
