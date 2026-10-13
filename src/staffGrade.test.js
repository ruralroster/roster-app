import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { gradeForSection, gradeForRank, gradeCanCover, roleForGrade } from './staffGrade';

jest.mock('@supabase/supabase-js', () => {
  // Every query resolves empty: no existing cards, no duty types.
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

describe('staff grade rules', () => {
  test('sheet sections map to grades', () => {
    expect(gradeForSection('consultant')).toBe('smo');
    expect(gradeForSection('locum')).toBe('smo');
    expect(gradeForSection('rmo')).toBe('registrar');
    expect(gradeForSection('intern')).toBe('intern');
    expect(gradeForSection(undefined)).toBeNull();
  });

  test('ranks map to grades', () => {
    expect(gradeForRank({ rank: 'consultant', requires_supervision: false })).toBe('smo');
    expect(gradeForRank({ rank: 'advanced_trainee', requires_supervision: true })).toBe('registrar');
    expect(gradeForRank({ rank: 'intern', requires_supervision: true })).toBe('intern');
    expect(gradeForRank(null)).toBeNull();
  });

  test('an SMO shift never reaches a registrar or intern; a registrar shift never an intern', () => {
    expect(gradeCanCover('smo', 'smo')).toBe(true);
    expect(gradeCanCover('registrar', 'smo')).toBe(false);
    expect(gradeCanCover('intern', 'smo')).toBe(false);
    expect(gradeCanCover('smo', 'registrar')).toBe(true);
    expect(gradeCanCover('registrar', 'registrar')).toBe(true);
    expect(gradeCanCover('intern', 'registrar')).toBe(false);
    expect(gradeCanCover('intern', 'intern')).toBe(true);
    expect(gradeCanCover(null, 'intern')).toBe(false);
    expect(gradeCanCover(null, null)).toBe(true);
  });

  test('graded slots are filled under the matching role', () => {
    expect(roleForGrade('smo')).toBe('consultant');
    expect(roleForGrade('registrar')).toBe('registrar');
    expect(roleForGrade('intern')).toBe('registrar');
  });
});

const DEC_FILE = path.join(__dirname, '..', 'Rosters', 'innisfail', '2026.2027 December 7th - January 3rd DRAFT.xlsx');

(fs.existsSync(DEC_FILE) ? describe : describe.skip)('importRosterWeek — unnamed rows (Dec DRAFT)', () => {
  const { importRosterWeek } = require('./supabaseClient');
  const { parseRosterWeek } = require('./rosterExcelImport');
  const workbook = XLSX.read(fs.readFileSync(DEC_FILE));
  const people = parseRosterWeek(workbook, 0).filter(p => p.unnamed);
  const refLists = {
    staffList: [],
    locations: ['Ward 1', 'Clinic', 'Emergency'].map((name, i) => ({ location_id: `loc${i}`, name })),
    activities: ['Ward Care Cover', 'Medical Clinic', 'Emergency Department Cover'].map((name, i) => ({ activity_id: `act${i}`, name })),
    leaveTypes: [],
  };

  test('ticked: every unnamed shift is added as unfilled, graded by section', async () => {
    const { data } = await importRosterWeek('dept', people, refLists, { dryRun: true, addUnnamedAsUnfilled: true });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(r => r.ok && r.action === 'unfilled')).toBe(true);
    expect(new Set(data.filter(r => r.rawLabel.includes('row 151')).map(r => r.gradeLabel))).toEqual(new Set(['Registrar']));
    expect(new Set(data.filter(r => /row 15[8]|row 162/.test(r.rawLabel)).map(r => r.gradeLabel))).toEqual(new Set(['Intern']));
  });

  test('unticked: one error per unnamed row, nothing else', async () => {
    const { data } = await importRosterWeek('dept', people, refLists, { dryRun: true, addUnnamedAsUnfilled: false });
    expect(data).toHaveLength(people.length);
    expect(data.every(r => !r.ok && /no name/.test(r.reason))).toBe(true);
  });
});
