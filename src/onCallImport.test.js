import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { onCallKindsForDay, dutyTypeForOnCallKind, parseRosterWeek, parseOnCallNote, cleanStaffLabel } from './rosterExcelImport';

jest.mock('@supabase/supabase-js', () => {
  // Every query resolves empty: no existing roster rows.
  const chain = () => {
    const q = new Proxy(() => {}, {
      get: (_, prop) => (prop === 'then'
        ? (resolve) => resolve({ data: [], count: 0, error: null })
        : () => q),
    });
    return q;
  };
  return { createClient: () => ({ from: chain, auth: { onAuthStateChange: () => ({ data: { subscription: {} } }) } }) };
});

// Innisfail's duty types as of 2026-10-16.
const DUTY_TYPES = [
  { key: 'am_coordinator', label: 'Anaesthetics (AM)', counts_as_on_call: false, active: true },
  { key: 'pm_coordinator', label: 'Anaesthetics on-call (Night)', counts_as_on_call: true, active: true },
  { key: 'first_on_call', label: 'ED on call (Night)', counts_as_on_call: true, active: true },
  { key: 'second_on_call', label: 'Obstetrics on-call (Night)', counts_as_on_call: true, active: true },
];

describe('onCallKindsForDay', () => {
  test('reads the CALL OBLIGATION note and the EDL + OC shift', () => {
    expect(onCallKindsForDay({ onCall: parseOnCallNote('Oncall + Anaes') })).toEqual(['ed', 'anaes']);
    expect(onCallKindsForDay({ onCall: parseOnCallNote('Obs') })).toEqual(['obs']);
    expect(onCallKindsForDay({ rawShift: 'EDL + OC', onCall: null })).toEqual(['ed']);
    expect(onCallKindsForDay({ rawShift: 'EDL + OC', onCall: parseOnCallNote('Oncall') })).toEqual(['ed']);
    expect(onCallKindsForDay({ rawShift: 'ED', onCall: null })).toEqual([]);
  });
});

describe('dutyTypeForOnCallKind', () => {
  test('picks the on-call slot by label, never a day role', () => {
    expect(dutyTypeForOnCallKind('ed', DUTY_TYPES).key).toBe('first_on_call');
    expect(dutyTypeForOnCallKind('anaes', DUTY_TYPES).key).toBe('pm_coordinator');
    expect(dutyTypeForOnCallKind('obs', DUTY_TYPES).key).toBe('second_on_call');
  });
  test('no match, or more than one, is null', () => {
    expect(dutyTypeForOnCallKind('obs', DUTY_TYPES.slice(0, 3))).toBeNull();
    expect(dutyTypeForOnCallKind('ed', [...DUTY_TYPES, { key: 'ed2', label: 'Second ED on call', counts_as_on_call: true }])).toBeNull();
  });
});

const OCT_FILE = path.join(__dirname, '..', 'Rosters', 'innisfail', '2026 October 12th - November 8th DRAFT.xlsx');

(fs.existsSync(OCT_FILE) ? describe : describe.skip)('importRosterWeek — on call (Oct DRAFT, week 1)', () => {
  const { importRosterWeek } = require('./supabaseClient');
  const workbook = XLSX.read(fs.readFileSync(OCT_FILE));
  const people = parseRosterWeek(workbook, 0).filter(p => !p.unnamed);
  const staffList = people.map((p, i) => ({ staff_id: `s${i}`, name: cleanStaffLabel(p.rawLabel) }));
  const refLists = { staffList, locations: [], activities: [], leaveTypes: [], dutyTypes: DUTY_TYPES };

  test('the sheet\'s on-call notes become one person per slot per night', async () => {
    const { data } = await importRosterWeek('dept', people, refLists, { dryRun: true });
    const onCall = data.filter(r => r.action === 'on call');
    const on = (date, label) => onCall.filter(r => r.date === date && r.dutyLabel === label).map(r => r.staffName);
    expect(on('14/10/2026', 'ED on call (Night)')).toEqual(['Andrea Marchant']);
    expect(on('14/10/2026', 'Anaesthetics on-call (Night)')).toEqual(['Andrea Marchant']);
    expect(on('14/10/2026', 'Obstetrics on-call (Night)')).toEqual(['Sally Barkla']);
    expect(on('16/10/2026', 'ED on call (Night)')).toEqual(['Thomas Newman']);
    expect(on('16/10/2026', 'Anaesthetics on-call (Night)')).toEqual(['Thomas Coombs']);
    // Nobody lands in the AM day role, and no slot is double-booked.
    expect(onCall.some(r => r.dutyLabel === 'Anaesthetics (AM)')).toBe(false);
    const slots = onCall.map(r => `${r.date}|${r.dutyLabel}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  // 13/10: Adrian Connor on EDL + OC with "Oncall + Anaes", Daniel
  // Charles on Anaes clinic with "Anaes".
  const clashFor = (data) => data.find(r => r.action === 'on call clash' && r.date === '13/10/2026');
  const staffIdOf = (name) => staffList.find(s => s.name === name).staff_id;

  test('two people down for one slot is a clash, the EDL + OC person suggested', async () => {
    const { data } = await importRosterWeek('dept', people, refLists, { dryRun: true });
    const clash = clashFor(data);
    expect(clash.ok).toBe(false);
    expect(clash.dutyLabel).toBe('Anaesthetics on-call (Night)');
    expect(clash.candidates.map(c => c.staffName).sort()).toEqual(['Adrian Connor', 'Daniel Charles']);
    expect(clash.suggestedStaffId).toBe(staffIdOf('Adrian Connor'));
    // His ED on call isn't contested.
    expect(data.filter(r => r.action === 'on call' && r.date === '13/10/2026' && r.dutyLabel === 'ED on call (Night)').map(r => r.staffName)).toEqual(['Adrian Connor']);
  });

  test('a real run with an unchosen clash writes nothing', async () => {
    const { error, deletionSummary } = await importRosterWeek('dept', people, refLists, { dryRun: false });
    expect(error.message).toMatch(/Choose who's on call/);
    expect(deletionSummary).toBeNull();
  });

  test('the officer\'s choice settles the clash', async () => {
    const clashKey = clashFor((await importRosterWeek('dept', people, refLists, { dryRun: true })).data).clashKey;
    const { data } = await importRosterWeek('dept', people, refLists, { dryRun: true, onCallChoices: { [clashKey]: staffIdOf('Daniel Charles') } });
    expect(clashFor(data).ok).toBe(true);
    expect(clashFor(data).chosenStaffId).toBe(staffIdOf('Daniel Charles'));
  });

  test('an ED-format-style file with no notes row writes no on-call', async () => {
    const noNotes = people.map(p => ({ ...p, days: p.days.map(({ rawOnCall, onCall, ...d }) => d) }));
    const { data } = await importRosterWeek('dept', noNotes, refLists, { dryRun: true });
    expect(data.some(r => r.action === 'on call' || /On call/.test(r.reason || ''))).toBe(false);
  });
});
