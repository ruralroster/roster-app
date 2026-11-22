import { crossSiteProblems, rowsForIcs, siteHue } from './mySites';

const shift = (dept, date, start, end, extra = {}) => ({ kind: 'shift', department_id: dept, department_name: dept, date, start_time: start, end_time: end, on_call: false, ...extra });

describe('All my sites', () => {
  it('finds under 10 hours between shifts at different sites', () => {
    const rows = [shift('Tully', '2026-11-23', '21:00', '08:30'), shift('Innisfail', '2026-11-24', '14:00', '22:00')];
    const [p] = crossSiteProblems(rows);
    expect(p.first.department_id).toBe('Tully');
    expect(p.overlap).toBe(false);
  });
  it('finds overlaps', () => {
    expect(crossSiteProblems([shift('A', '2026-11-23', '08:00', '17:00'), shift('B', '2026-11-23', '16:00', '22:00')])[0].overlap).toBe(true);
  });
  it('leaves the same site, on call and enough rest alone', () => {
    expect(crossSiteProblems([shift('A', '2026-11-23', '08:00', '17:00'), shift('A', '2026-11-23', '18:00', '22:00')])).toEqual([]);
    expect(crossSiteProblems([shift('A', '2026-11-23', '08:00', '17:00'), shift('B', '2026-11-23', '18:00', '23:00', { on_call: true })])).toEqual([]);
    expect(crossSiteProblems([shift('A', '2026-11-23', '08:00', '17:00'), shift('B', '2026-11-24', '08:00', '17:00')])).toEqual([]);
  });
  it('puts the site in each calendar event', () => {
    const [e] = rowsForIcs([{ ...shift('Tully Hospital', '2026-11-23', '08:00', '17:00'), ref_id: 'x', location_name: 'Ward' }]);
    expect(e.locations.name).toBe('Tully Hospital — Ward');
    expect(rowsForIcs([{ kind: 'leave', date: '2026-11-23', start_time: '08:00', end_time: '17:00' }])).toEqual([]);
  });
  it('gives each site the same colour every time', () => {
    expect(siteHue('Tully Hospital')).toBe(siteHue('Tully Hospital'));
  });
});
