import * as XLSX from 'xlsx';
import { parseTullyRange, getTullyWeekRanges, getTullySheets, getTullyStaffRoster, resolveTullyDay, parseTullyName, applyTullyMappings, SBOC_DUTY_LABEL } from './tullyRosterExcelImport';

// A made-up fortnight in Tully's layout (names are invented).
const MON1 = 46335; // 09/11/2026
const dates = (first) => Array.from({ length: 7 }, (_, i) => first + i);
const blank = (n = 19) => Array(n).fill('');
const row = (week1Name, w1, week2Name, w2, extra = {}) => {
  const r = blank();
  r[0] = week1Name; r[8] = week2Name;
  w1.forEach((v, i) => { r[1 + i] = v; });
  w2.forEach((v, i) => { r[9 + i] = v; });
  Object.entries(extra).forEach(([c, v]) => { r[c] = v; });
  return r;
};
const header = () => row('Term5A', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], 'Term5A', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const dateRow = () => row('', dates(MON1), '', dates(MON1 + 7));
const E = ['', '', '', '', '', '', ''];

function workbook() {
  const rows = [
    row('Senior Medical Officers Tully Hospital', E, '', E),
    header(), dateRow(),
    row('Ann Example 111111', ['0800-1700', '0800-1700', '', '', '', '', ''], 'Ann Example 111111', E),
    row('', ['', 'SBOC', '', '', '', '', ''], '', E),
    row('Work Area', ['ED', 'GP', '', '', '', '', ''], 'Work Area', E, { 18: '10' }),
    [],
    // The current SMO section: the one that counts.
    row('Senior Medical Officers Tully Hospital', E, '', E),
    header(), dateRow(),
    row('Ann Example 111111', ['0800-1700', '0800-1700', '0800-1700', '', '', '', ''], 'Ann Example 111111', ['0800-1700', '', '', '', '', '', '']),
    row('', ['', 'SBOC', '', '', '', '', ''], '', ['N/A', '', '', '', '', '', '']),
    row('Work Area', ['ED', 'Ward/ED', 'A/L', '', '', '', ''], 'Work Area', ['senate', '', '', '', '', '', ''], { 18: '4' }),
    row('Locum Needed', ['1200-2200', '', '', '', '', '', ''], 'Locum Needed', E),
    row('', E, '', E),
    row('Work Area', ['ED', '', '', '', '', '', ''], 'Work Area', E),
    row('Resident Medical Officers Tully Hospital', E, '', E),
    header(), dateRow(),
    row('Ben Sample 222222', ['2100-0830', '', '', '', '', '', ''], 'Ben Sample 222222', ['', '', '', '', '', '', '']),
    row('', ['11', 'N/A', '', '', '', '', ''], '', E),
    row('Work Area', ['ED/ward', '', '', '', '', '', ''], 'Work Area', ['stddown', '', '', '', '', '', '']),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '09.11.26');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Term']]), 'Dates and Requests');
  return wb;
}

describe('Tully roster import', () => {
  it('finds the fortnight tabs by name', () => {
    expect(getTullySheets(workbook())).toEqual([{ sheetName: '09.11.26', monday: '2026-11-09' }]);
  });

  it('offers the whole fortnight and each week', () => {
    expect(getTullyWeekRanges(workbook(), '09.11.26').map(r => [r.start, r.end])).toEqual([
      ['09/11/2026', '22/11/2026'], ['09/11/2026', '15/11/2026'], ['16/11/2026', '22/11/2026'],
    ]);
  });

  it('reads the last SMO section, hours over work areas, leave and SBOC', () => {
    const people = parseTullyRange(workbook(), '09.11.26', 0);
    const ann = people.find(p => p.rawLabel === 'Ann Example');
    expect(ann.section).toBe('consultant');
    expect(ann.payroll).toBe('111111');
    expect(ann.fte).toBe(0.4);
    expect(ann.days).toHaveLength(14);
    expect(ann.days[0].resolvedShift).toEqual({ segments: [{ location: 'Emergency Department', activity: 'SMO Cover', start: '08:00', end: '17:00' }] });
    expect(ann.days[1].resolvedShift.segments[0].location).toBe('Ward & ED');
    expect(ann.days[1].onCallDuties).toEqual([SBOC_DUTY_LABEL]);
    expect(ann.days[2].resolvedShift).toEqual({ leaveCode: 'AL' }); // hours over A/L are leave
    expect(ann.days[7].resolvedShift).toEqual({ unmapped: 'senate' });
    expect(ann.days[0].date).toBe('09/11/2026');
    expect(ann.days[7].date).toBe('16/11/2026');
  });

  it('keeps Locum Needed as an unfilled shift', () => {
    const locum = parseTullyRange(workbook(), '09.11.26', 0).find(p => p.unnamed);
    expect(locum.section).toBe('consultant');
    expect(locum.days[0].resolvedShift.segments[0]).toMatchObject({ start: '12:00', end: '22:00' });
  });

  it('reads RMOs: nights, unavailable, public-holiday stand-down', () => {
    const ben = parseTullyRange(workbook(), '09.11.26', 0).find(p => p.rawLabel === 'Ben Sample');
    expect(ben.section).toBe('rmo');
    expect(ben.days[0].resolvedShift.segments[0]).toMatchObject({ location: 'Ward & ED', activity: 'RMO Cover', start: '21:00', end: '08:30' });
    expect(ben.days[0].onCallDuties).toBeUndefined();
    expect(ben.days[1].resolvedShift).toEqual({ availability: false });
    expect(ben.days[7].resolvedShift).toEqual({ leaveCode: 'PHSD' });
  });

  it('imports one week on its own', () => {
    const week2 = parseTullyRange(workbook(), '09.11.26', 2);
    expect(week2.find(p => p.rawLabel === 'Ann Example').days.map(d => d.date)[0]).toBe('16/11/2026');
  });

  it('keeps the sheet hours for a mapped work area', () => {
    const people = applyTullyMappings(parseTullyRange(workbook(), '09.11.26', 0), {
      senate: { segments: [{ location: 'Non-clinical', activity: 'Meeting', start: '09:00', end: '10:00' }] },
    });
    expect(people.find(p => p.rawLabel === 'Ann Example').days[7].resolvedShift.segments[0]).toEqual({ location: 'Non-clinical', activity: 'Meeting', start: '08:00', end: '17:00' });
  });

  it('lists staff from the latest fortnights, not placeholders', () => {
    const staff = getTullyStaffRoster(workbook(), null, new Date('2026-11-18T00:00:00'));
    expect(staff.map(p => [p.name, p.section, p.payroll])).toEqual([['Ann Example', 'consultant', '111111'], ['Ben Sample', 'rmo', '222222']]);
  });

  it('parses names and days', () => {
    expect(parseTullyName('Locum Needed')).toMatchObject({ name: '', placeholder: true });
    expect(parseTullyName('NO RMO').name).toBe('');
    expect(resolveTullyDay('', '', '')).toBeNull();
    expect(resolveTullyDay('0800-1700', '', '')).toEqual({ unmapped: 'No work area' });
    expect(resolveTullyDay('0800-1700', "carer's leave", 'ED')).toEqual({ leaveCode: 'CL' });
  });
});
