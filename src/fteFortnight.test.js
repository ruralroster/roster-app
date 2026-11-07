import { payFortnightRange, fortnightTargetHours, hoursBooked, fteFull, shiftHours } from './fteFortnight';

const shift = (date, start, end, extra = {}) => ({ staff_id: 'me', date, shift_id: `${start}-${end}`, shifts: { start_time: start, end_time: end }, ...extra });

describe('payFortnightRange', () => {
  it('finds the pay fortnight a date is in', () => {
    expect(payFortnightRange('2026-06-08')).toEqual({ from: '2026-06-08', to: '2026-06-21' });
    expect(payFortnightRange('2026-11-07')).toEqual({ from: '2026-10-26', to: '2026-11-08' });
    expect(payFortnightRange('2026-05-30')).toEqual({ from: '2026-05-25', to: '2026-06-07' });
  });
});

describe('hours', () => {
  it('is 44 hours a week at full time', () => {
    expect(fortnightTargetHours(1)).toBe(88);
    expect(fortnightTargetHours(0.5)).toBe(44);
  });

  it('measures shifts, overnight too', () => {
    expect(shiftHours('2026-11-02', '08:00', '18:00')).toBe(10);
    expect(shiftHours('2026-11-02', '22:00', '08:00')).toBe(10);
  });

  it('counts a shift once, skips on-call cards, and counts leave', () => {
    const bookings = [
      shift('2026-10-26', '08:00', '18:00'),
      shift('2026-10-26', '08:00', '18:00'), // the same shift on a second session card
      shift('2026-10-27', '17:00', '08:00', { on_call: true }),
      { staff_id: 'me', date: '2026-10-28', shift_id: null, leave_code: 'AL', shifts: null },
    ];
    expect(hoursBooked('me', '2026-10-26', '2026-11-08', bookings)).toBeCloseTo(10 + 8.8);
  });
});

describe('fteFull', () => {
  const tenHourDays = (n) => Array.from({ length: n }, (_, i) => shift(`2026-10-${26 + i}`, '08:00', '18:00'));
  it('is full once their hours reach the target', () => {
    expect(fteFull({ staff_id: 'me', fte: 0.5 }, '2026-11-05', tenHourDays(4))).toBe(false); // 40 of 44
    expect(fteFull({ staff_id: 'me', fte: 0.5 }, '2026-11-05', tenHourDays(5))).toBe(true); // 50 of 44
  });
  it('starts again in the next fortnight', () => {
    expect(fteFull({ staff_id: 'me', fte: 0.5 }, '2026-11-09', tenHourDays(5))).toBe(false);
  });
});
