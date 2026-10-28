import { blockedSlots } from './swapSlots';

describe('blockedSlots', () => {
  const listed = { shift_date: '2026-11-05', start_time: '08:00:00', end_time: '18:00:00' };
  const shifts = [
    listed,
    { shift_date: '2026-11-03', start_time: '22:00:00', end_time: '08:00:00' }, // a night
    { shift_date: '2026-11-08', start_time: '08:00:00', end_time: '18:00:00' }, // a day
  ];
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const b = blockedSlots(shifts, listed, days, '2026-11-02');

  it("blocks the shift being given away, but not the other half of that day (a same-day swap)", () => {
    expect(b.has('2026-11-05:day')).toBe(true);
    expect(b.has('2026-11-05:night')).toBe(false);
  });
  it('blocks days already worked, and the 10-hour rest either side', () => {
    expect(b.has('2026-11-03:day')).toBe(true);
    expect(b.has('2026-11-03:night')).toBe(true);
    expect(b.has('2026-11-04:day')).toBe(true); // straight after the night
    expect(b.has('2026-11-07:night')).toBe(true); // straight before the day
    expect(b.has('2026-11-04:night')).toBe(false);
    expect(b.has('2026-11-06:day')).toBe(false);
  });
  it('blocks days already gone', () => {
    expect(b.get('2026-11-01:day')).toBe("That day's gone");
    expect(b.has('2026-11-02:day')).toBe(false);
  });
});
