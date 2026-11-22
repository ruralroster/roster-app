import * as XLSX from 'xlsx';
import { codeKey, personName, getGastroSheets, getGastroWeekRanges, parseGastroRange, getGastroStaffRoster, ON_CALL_LABEL } from './gastroRosterExcelImport';

// A made-up four-week roster in the gastro layout (invented names).
const blank = () => Array(31).fill('');
const row = (b, c, cells = {}) => { const r = blank(); r[1] = b; r[2] = c; Object.entries(cells).forEach(([d, v]) => { r[3 + Number(d)] = v; }); return r; };
function workbook() {
  const roster = [
    ['KEY'], [], [], [],
    ['Roster Period', '16/11/26 - 13/12/26'],
    ['Referene to Editing Rights', 'Date Roster Confirmed', '', 'Mon'],
    ['', 'xxxx', '', '16-Nov'],
    row('Procedure Room 1', 'AM', { 0: 'AE (G)', 1: 'Reg (G)' }),
    row('', 'PM', { 0: 'AE(G)' }),
    row('On Call Endoscopy', '', { 0: 'BS (M)', 1: 'BS (M)' }),
    row('Cairns Gastro Clinic', 'PM 2', { 2: 'BS (G)' }),
    row('Atherton Endoscopy', '', { 3: 'AE (G)' }),
    row('Leave', '1', { 4: 'AE (G)', 5: 'AE (G)' }),
  ];
  const reference = [['Name', 'Specialty', 'CODE'], ['Example, Ann', 'Gastro', 'AE (G)'], ['Ben Sample', 'Medical', 'BS (M)'], ['', 'Gastro Reg 1', 'Reg 1 (G)']];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['template']]), 'MASTER - template');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reference), 'Reference');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(roster), 'R6 16.11.26');
  return wb;
}

describe('gastro roster import', () => {
  it('reads codes and names', () => {
    expect(codeKey('PB (G)')).toBe('PB(G)');
    expect(codeKey('PB(G)')).toBe('PB(G)');
    expect(codeKey('Reg 1 (G)')).toBe('REG1(G)');
    expect(codeKey('Cycle 1')).toBeNull();
    expect(personName('Boyd, Peter')).toBe('Peter Boyd');
    expect(personName('Gerard Bennett')).toBe('Gerard Bennett');
  });

  it('finds roster tabs by name, dated from the tab', () => {
    expect(getGastroSheets(workbook())).toEqual([{ sheetName: 'R6 16.11.26', monday: '2026-11-16' }]);
    expect(getGastroWeekRanges(workbook(), 'R6 16.11.26')[0]).toMatchObject({ start: '16/11/2026', end: '13/12/2026' });
  });

  it('turns sessions into each person\'s days', () => {
    const people = parseGastroRange(workbook(), 'R6 16.11.26', 0);
    const ann = people.find(p => p.rawLabel === 'Ann Example');
    expect(ann.days).toHaveLength(28);
    expect(ann.days[0].resolvedShift.segments.map(s => [s.location, s.start, s.end])).toEqual([['Procedure Room 1', '08:00', '12:30'], ['Procedure Room 1', '13:00', '17:00']]);
    expect(ann.days[3].resolvedShift.segments[0]).toMatchObject({ location: 'Atherton', activity: 'Outreach Endoscopy', start: '08:00', end: '17:00' });
    expect(ann.days[4].resolvedShift).toEqual({ leaveCode: 'AL' });
    const ben = people.find(p => p.rawLabel === 'Ben Sample');
    expect(ben.days[0].onCallDuties).toEqual([ON_CALL_LABEL]);
    // "BS (G)" is Ben's initials with the wrong letter: still Ben.
    expect(ben.days[2].resolvedShift.segments[0]).toMatchObject({ location: 'Cairns Gastro Clinic', start: '13:00' });
  });

  it('makes a registrar slot an empty place', () => {
    const slots = parseGastroRange(workbook(), 'R6 16.11.26', 0).filter(p => p.unnamed);
    expect(slots).toHaveLength(1);
    expect(slots[0].days[1].resolvedShift.segments[0]).toMatchObject({ location: 'Procedure Room 1', start: '08:00' });
  });

  it('lists the Reference tab as staff, not the registrar slots', () => {
    expect(getGastroStaffRoster(workbook()).map(p => [p.name, p.rank, p.fte])).toEqual([['Ann Example', 'Gastroenterologist', 1], ['Ben Sample', 'Physician', 0]]);
  });
});
