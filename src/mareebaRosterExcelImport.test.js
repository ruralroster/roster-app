import * as XLSX from 'xlsx';
import { parseMareebaRange, getMareebaWeekRanges, getMareebaStaffRoster, resolveMareebaCell, cleanMareebaName, resolveBackupName, BACKUP_LABELS } from './mareebaRosterExcelImport';

// A made-up Mareeba-style roster (invented names): days down, people across.
const W = 24;
const row = (cells) => { const r = Array(W).fill(''); Object.entries(cells).forEach(([c, v]) => { r[XLSX.utils.decode_col(c)] = v; }); return r; };
function workbook() {
  const rows = [
    row({ N: 'Leave Planner' }),
    row({ A: 'ED SMO AM', N: 'Nov 26 - Dec 26', P: 'Ann Nurse - NP', Q: 'SMO Ann Example', R: 'Dr Bob Locumson (Locum)', S: 'Shifts to be filled', T: 'ED Back up', U: 'Visiting Surgeon', V: 'Second PHO', W: 'Dr Cath Junior', X: 'Dr Ann Other' }),
    row({ N: 'MON', O: '30', P: 'ED:07:00 - 17:30', Q: 'Emergency 12:30-2200', R: 'Ward/Ward 0745-1715', S: 'LG/LG 0745-1715', T: 'Ann E', U: 'Endo', W: 'L: 1230-2100', X: 'Rec Leave' }),
    row({ N: 'TUE', O: '1', Q: 'CST 4hrs 0745-1145', R: 'Not Available', T: 'Bypass 1700', V: 'ED:0745-1615', W: 'N:2100-0830', X: 'Travel' }),
    row({ N: 'Term 5.2 Commences' }),
    row({ N: 'WED', O: '2', Q: 'East:07:45-16:15', W: 'East:07:45-16:15' }),
    row({ P: '1', Q: '0.75', R: '', W: '0.5', X: 'Casual' }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Nov-Dec');
  return wb;
}

describe('Mareeba roster import', () => {
  it('dates the days from the months above, across the month end', () => {
    const r = getMareebaWeekRanges(workbook(), 'Nov-Dec');
    expect([r[0].start, r[0].end]).toEqual(['30/11/2026', '02/12/2026']);
  });

  it('reads people, standard shifts and leave', () => {
    const people = parseMareebaRange(workbook(), 'Nov-Dec', 0);
    const ann = people.find(p => p.rawLabel === 'Ann Example');
    expect(ann.days[0].resolvedShift.segments[0]).toMatchObject({ location: 'Emergency', activity: 'SMO Cover', start: '12:30', end: '22:00' });
    expect(ann.days[1].resolvedShift.segments[0]).toMatchObject({ location: 'Non-clinical', start: '07:45', end: '11:45' });
    expect(ann.days[2].resolvedShift.segments[0]).toMatchObject({ location: 'East Ward', start: '07:45', end: '17:15' });
    expect(ann.days[0].onCallDuties).toEqual([BACKUP_LABELS.ed]);
    const cath = people.find(p => p.rawLabel === 'Cath Junior');
    expect(cath.days[0].resolvedShift.segments[0]).toMatchObject({ activity: 'PHO Cover', start: '12:30', end: '21:30' });
    expect(cath.days[1].resolvedShift.segments[0]).toMatchObject({ start: '21:00', end: '08:30' });
    expect(cath.days[2].resolvedShift.segments[0]).toMatchObject({ location: 'East Ward', start: '07:45', end: '16:45' });
    const np = people.find(p => p.rawLabel === 'Ann Nurse');
    expect(np.days[0].resolvedShift.segments[0]).toMatchObject({ start: '07:00', end: '17:30' }); // the NP keeps her hours
    expect(people.find(p => p.rawLabel === 'Ann Other').days[0].resolvedShift).toEqual({ leaveCode: 'AL' });
    expect(people.find(p => p.rawLabel === 'Bob Locumson').days[1].resolvedShift).toEqual({ availability: false });
  });

  it('makes gaps and visiting sessions unnamed', () => {
    const extras = parseMareebaRange(workbook(), 'Nov-Dec', 0).filter(p => p.unnamed);
    expect(extras.map(e => [e.rawLabel, e.section])).toEqual([['Shifts to be filled', 'consultant'], ['Visiting Surgeon', 'visiting'], ['Second PHO', 'rmo']]);
  });

  it('lists staff with rank and FTE', () => {
    expect(getMareebaStaffRoster(workbook(), 'Nov-Dec').map(p => [p.name, p.rank, p.fte])).toEqual([
      ['Ann Example', 'SMO', 0.75], ['Ann Nurse', 'Nurse Practitioner', 1], ['Ann Other', 'PHO', 0], ['Bob Locumson', 'SMO', 0], ['Cath Junior', 'PHO', 0.5],
    ]);
  });

  it('matches back-up names', () => {
    const people = ['Andrew Mason', 'Rachel Boland', 'Rachel Copson', 'Marian Morrissey'];
    expect(resolveBackupName('Andy', people)).toBe('Andrew Mason');
    expect(resolveBackupName('Rachel B', people)).toBe('Rachel Boland');
    expect(resolveBackupName('Rachel', people)).toBeNull();
    expect(resolveBackupName('Marian from 1700', people)).toBe('Marian Morrissey');
    expect(cleanMareebaName('SMO  Cassandra McKay').name).toBe('Cassandra McKay');
    expect(resolveMareebaCell('Travel', 'consultant')).toEqual({ unmapped: 'Travel' });
  });
});
