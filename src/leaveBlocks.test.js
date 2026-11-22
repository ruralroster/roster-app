import { leaveBlocks } from './leaveBlocks';
import { hoursBooked, leaveBlockHoursPerDay } from './fteFortnight';

describe('leave blocks', () => {
  it('counts the FTE over the block', () => {
    expect(leaveBlockHoursPerDay(1) * 14).toBeCloseTo(88, 0);
    expect(leaveBlockHoursPerDay(0.5) * 14).toBeCloseTo(44, 0);
  });

  it("uses a leave day's own hours towards FTE", () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ staff_id: 'a', date: `2026-12-${String(1 + i).padStart(2, '0')}`, leave_code: 'AL', leave_hours: leaveBlockHoursPerDay(0.5) }));
    expect(Math.round(hoursBooked('a', '2026-11-01', '2026-12-31', days))).toBe(44);
  });

  it('groups days into blocks by leave type', () => {
    const rows = [
      { date: '2026-12-01', leave_type_id: 'al', leave_hours: 6.29 },
      { date: '2026-12-02', leave_type_id: 'al', leave_hours: 6.29 },
      { date: '2026-12-03', leave_type_id: 'pdl', leave_hours: null },
      { date: '2026-12-05', leave_type_id: 'al', leave_hours: 6.29 },
    ];
    expect(leaveBlocks(rows).map(b => [b.start, b.end, b.leaveTypeId, b.days])).toEqual([
      ['2026-12-01', '2026-12-02', 'al', 2], ['2026-12-03', '2026-12-03', 'pdl', 1], ['2026-12-05', '2026-12-05', 'al', 1],
    ]);
    expect(leaveBlocks(rows)[1].someUsualShift).toBe(true);
  });
});
