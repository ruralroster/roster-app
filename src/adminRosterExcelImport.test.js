import * as XLSX from 'xlsx';
import { parseAdminRange, getAdminSheets, adminHistoryTabs, resolveAdminDay, getAdminStaffRoster } from './adminRosterExcelImport';

// A made-up admin fortnight (invented names).
const E = Array(7).fill('');
const row = (a, w1, w2 = E) => [a, ...w1, ...w2];
const tab = (area1) => XLSX.utils.aoa_to_sheet([
  ['Administration Example Hospital'],
  row('', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  row('', Array.from({ length: 7 }, (_, i) => 46349 + i), Array.from({ length: 7 }, (_, i) => 46356 + i)),
  row('Ann Example 111111', ['0800-1606', '0830-1636', '', '0700-1506', '', '', ''], ['0800-1606', '', '', '', '', '', '']),
  row('', ['7.6', '7.6', '', '7.6', '', '', '']),
  row('Work Area', [area1, 'ROI/SC', 'REC LEAVE', 'ED AM', 'N/A', '', ''], ['PHNR', '', '', '', '', '', '']),
]);
function workbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, tab('RCP'), '23.11.26');
  XLSX.utils.book_append_sheet(wb, tab('PTS#'), 'Actual 23.11.26');
  return wb;
}

describe('admin roster import', () => {
  it('finds fortnight tabs and prefers the Actual one for history', () => {
    expect(getAdminSheets(workbook()).map(t => [t.sheetName, t.actual])).toEqual([['23.11.26', false], ['Actual 23.11.26', true]]);
    expect(adminHistoryTabs(workbook(), new Date('2026-12-01T00:00:00'))).toEqual(['Actual 23.11.26']);
  });

  it('reads hours over work codes, leave and N/A', () => {
    const [ann] = parseAdminRange(workbook(), '23.11.26', 0);
    expect(ann.rawLabel).toBe('Ann Example');
    expect(ann.days[0]).toMatchObject({ date: '23/11/2026' });
    expect(ann.days[0].resolvedShift.segments[0]).toEqual({ location: 'RCP', activity: 'Admin Cover', start: '08:00', end: '16:06' });
    expect(ann.days[1].resolvedShift.segments[0].location).toBe('ROI');
    expect(ann.days[2].resolvedShift).toEqual({ leaveCode: 'AL' });
    expect(ann.days[3].resolvedShift.segments[0]).toMatchObject({ location: 'ED', start: '07:00', end: '15:06' });
    expect(ann.days[4].resolvedShift).toEqual({ availability: false });
    expect(ann.days[7].resolvedShift).toEqual({ unmapped: 'PHNR' });
  });

  it('ignores a note mark on a code', () => {
    expect(resolveAdminDay('0800-1606', 'PTS#').segments[0].location).toBe('PTS');
  });

  it('works out FTE from 76 hours a fortnight', () => {
    const [ann] = getAdminStaffRoster(workbook(), new Date('2026-12-01T00:00:00'));
    // 8.1 + 8.1 + 7.6 (leave) + 8.1 hours = 31.9 of 76 (the PHNR day isn't known yet).
    expect(ann).toMatchObject({ name: 'Ann Example', payroll: '111111', fte: 0.4 });
  });
});
