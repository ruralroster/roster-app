import * as XLSX from 'xlsx';
import { cellPieces, readPersonLabel, resolveShiftListCode, getShiftListDateRanges, parseShiftListRange, getShiftListStaffRoster } from './shiftListRosterExcelImport';

// A cell with several pieces of text, as the export writes them (SheetJS
// keeps them as rich-text runs in cell.r).
const runs = (...pieces) => ({
  t: 's',
  v: pieces.join(''),
  r: pieces.map(p => `<r><rPr><sz val="13"/></rPr><t xml:space="preserve">${p.replace(/&/g, '&amp;')}</t></r>`).join(''),
});

function workbook(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(c => (typeof c === 'string' ? c : ''))));
  rows.forEach((row, r) => row.forEach((c, col) => {
    if (c && typeof c === 'object') ws[XLSX.utils.encode_cell({ r, c: col })] = c;
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mon 9, Nov-Wed 11, Nov');
  return wb;
}

const sample = () => workbook([
  ['Atherton - Medicine | Roster'],
  ['Exported Wednesday, November 11th, 2026 @ 16:50 Australia/Brisbane'],
  [],
  ['', 'Mon 9, Nov', 'Tue 10, Nov', 'Wed 11, Nov'],
  ['Senior Medical Officer'],
  [runs('Quinlan, Tessa\r\n', 'Senior Medical Officer\r\n', 'FTE 80%\r\n', '0400 000 001'),
    runs('Remote On-Call Obstetrics', 'Ward - South - SMO'), 'Unavailable', runs('Chemotherapy\n08:00 - 13:00')],
  [runs('Okoro, Felix\r\n', 'Senior Medical Officer\r\n', 'FTE 100%\r\n', '0400 000 002'),
    'ED Fast Track - WD', runs('ED Flow SMO - WD', 'Standby On-Call'), 'Mystery Clinic'],
  ['No Role'],
  [runs('Quinlan, Tessa'), '', '', 'Available'],
]);

describe('reading the export', () => {
  test('a cell splits into its pieces, never on the joined text', () => {
    expect(cellPieces(runs('Remote On-Call Obstetrics', 'Ward - South - SMO'))).toEqual(['Remote On-Call Obstetrics', 'Ward - South - SMO']);
    expect(cellPieces({ t: 's', v: 'Unavailable' })).toEqual(['Unavailable']);
    expect(cellPieces(runs('LSCS + D&C'))).toEqual(['LSCS + D&C']);
  });

  test('a person is name, role, FTE and phone; a heading is not a person', () => {
    expect(readPersonLabel(['Barrie, Angela\n', 'Senior Medical Officer\n', 'FTE 80%\n', '0400 739 684']))
      .toEqual({ name: 'Angela Barrie', role: 'Senior Medical Officer', fte: 0.8, phone: '0400 739 684' });
    expect(readPersonLabel(['VanBeekhuizenB'])).toMatchObject({ name: 'B Van Beekhuizen', fte: null });
    expect(readPersonLabel(['Williams, Charles', 'Senior Medical Officer', 'FTE null%', '0497 000 000']).fte).toBeNull();
    expect(readPersonLabel(['Senior Medical Officer'])).toBeNull();
    expect(readPersonLabel(['No Role'])).toBeNull();
  });

  test('shift names resolve to a job, own hours, on call or availability', () => {
    expect(resolveShiftListCode('ED Fast Track - WD').segments[0]).toMatchObject({ location: 'Emergency', job: 'ED Fast Track', start: '08:00', end: '16:30' });
    expect(resolveShiftListCode('Ward  - SMO - WE').segments[0].job).toBe('Weekend Ward');
    expect(resolveShiftListCode('Chemotherapy\n08:00 - 13:00').segments[0]).toMatchObject({ job: 'Chemotherapy', start: '08:00', end: '13:00' });
    expect(resolveShiftListCode('Remote On-Call Anaesthetics')).toEqual({ onCall: 'Anaesthetics On-Call' });
    expect(resolveShiftListCode('Remote On-Call Paeds')).toEqual({ onCall: 'Remote On-Call Paeds' });
    expect(resolveShiftListCode('Unavailable')).toEqual({ availability: false });
    expect(resolveShiftListCode('Mystery Clinic')).toEqual({ unmapped: 'Mystery Clinic' });
  });

  test('a saved mapping wins and keeps the piece\'s own hours', () => {
    const codeMap = { 'Mystery Clinic': { segments: [{ location: 'Clinic', activity: 'PICC', start: '08:00', end: '16:30' }] } };
    expect(resolveShiftListCode('Mystery Clinic', codeMap).segments[0].activity).toBe('PICC');
    expect(resolveShiftListCode('Mystery Clinic\n09:00 - 12:00', codeMap).segments[0]).toMatchObject({ start: '09:00', end: '12:00' });
  });
});

describe('a file', () => {
  test('offers the whole file, then each week', () => {
    const ranges = getShiftListDateRanges(sample());
    expect(ranges[0]).toMatchObject({ start: '09/11/2026', end: '11/11/2026', label: 'Whole file (09/11/2026–11/11/2026)' });
    expect(ranges).toHaveLength(2);
  });

  test('each person once, with their days, on call and availability', () => {
    const people = parseShiftListRange(sample(), 0);
    expect(people.map(p => p.rawLabel)).toEqual(['Tessa Quinlan', 'Felix Okoro']);
    const [tessa, felix] = people;
    expect(tessa.fte).toBe(0.8);
    expect(tessa.days[0].onCallDuties).toEqual(['Obstetrics On-Call']);
    expect(tessa.days[0].resolvedShift.segments.map(s => s.job)).toEqual(['Ward South']);
    expect(tessa.days[1].resolvedShift).toEqual({ availability: false });
    // Wed: Chemotherapy from her role listing, Available from "No Role" — the shift wins.
    expect(tessa.days[2].resolvedShift.segments[0]).toMatchObject({ job: 'Chemotherapy', start: '08:00', end: '13:00' });
    expect(felix.days[1].onCallDuties).toEqual(['Standby On-Call']);
    expect(felix.days[2].resolvedShift).toMatchObject({ unmapped: 'Mystery Clinic' });
  });

  test('junior shifts, and a "(2)" note marker is ignored', () => {
    expect(resolveShiftListCode('ED Night Shift\nNo Location').segments[0]).toMatchObject({ job: 'ED Night', start: '21:45', end: '08:15' });
    expect(resolveShiftListCode('ED Early Junior\nNo Location\n(1)').segments[0]).toMatchObject({ job: 'ED Early Junior', start: '07:30' });
    expect(resolveShiftListCode('Ward  - South - JNR - WE\nNo Location').segments[0].job).toBe('Weekend Ward');
  });

  test('newer exports\' "No Location" line is ignored', () => {
    expect(resolveShiftListCode('ED Mid Shift\nNo Location').segments[0]).toMatchObject({ job: 'ED Mid', start: '10:30' });
    expect(resolveShiftListCode('Obstetrics\n13:30 - 16:30\nNo Location').segments[0]).toMatchObject({ start: '13:30', end: '16:30' });
  });

  test('the staff list has full names, FTE, phone and the grade their role suggests', () => {
    expect(getShiftListStaffRoster(sample())).toEqual([
      { name: 'Felix Okoro', fte: 1, phone: '0400 000 002', role: 'Senior Medical Officer', grade: 'senior' },
      { name: 'Tessa Quinlan', fte: 0.8, phone: '0400 000 001', role: 'Senior Medical Officer', grade: 'senior' },
    ]);
  });
});
