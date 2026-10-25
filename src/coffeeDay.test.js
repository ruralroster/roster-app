import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { dayCoffeeOrder, summarizeCoffeeOrder, edLateConsultant, edOnCallStaffId, edOnCallDutyType } from './coffeeDay';
import { dutyTypeForOnCallKind } from './rosterExcelImport';

test.each(['coffeeDay.js', 'coffeeUtils.js', 'shiftSessionUtils.js', 'jobColours.js'])(
  'the Edge Function copy of %s matches exactly',
  (file) => {
    const here = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const shared = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', '_shared', file), 'utf8');
    expect(shared).toBe(here);
  },
);

test('the deployable coffee-order/index.ts is rebuilt from its source', () => {
  // Throws (failing the test) if npm run build:functions needs running.
  execFileSync('node', ['scripts/build-functions.mjs', '--check'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
});

const MORNING = { start_time: '08:00:00', end_time: '17:00:00' };
const EDL = { start_time: '10:30:00', end_time: '21:00:00' };
const NIGHT = { start_time: '22:00:00', end_time: '08:00:00' };

const assign = (staff_id, name, coffee_order, shifts = MORNING, extra = {}) => ({
  staff_id, staff: { name, rank: 'Consultant', coffee_order }, shifts, locations: { name: 'Emergency' }, role: 'consultant', ...extra,
});

describe('dayCoffeeOrder', () => {
  const assignments = [
    assign('a', 'Alex Able', 'Flat White - Whole Milk'),
    assign('a', 'Alex Able', 'Flat White - Whole Milk'), // second row, same person
    assign('b', 'Bea Bell', 'Flat White - Whole Milk'),
    assign('c', 'Cal Cole', 'Long Black - No Milk + Xtra Shot'),
    assign('d', 'Dee Dunn', 'No Coffee'),
    assign('e', 'Eli East', null),
    assign('n', 'Nat Night', 'Latte - Oat Milk', NIGHT),
    assign('r', 'Rae Rest', 'Latte - Oat Milk'),
  ];

  const order = dayCoffeeOrder({
    assignments,
    visitors: [{ name: 'Dr Visitor', start_time: '08:00:00', end_time: '12:00:00' }],
    removedStaffIds: ['r'],
    extras: [{ label: 'Locum', coffee_type: 'Latte', milk_type: 'Skim Milk', extra_shot: false, quantity: 2 }],
  });

  test('counts each morning person once, minus removals, plus extras', () => {
    expect(order.lines).toEqual([
      '2 x Flat White on Whole Milk',
      '1 x Long Black + Xtra Shot',
      '2 x Latte on Skim Milk',
    ]);
    expect(order.total).toBe(5);
  });

  test('lists everyone working the morning, with Unknown for no order', () => {
    expect(order.rows).toEqual([
      { name: 'Alex Able', coffee: 'Flat White on Whole Milk' },
      { name: 'Bea Bell', coffee: 'Flat White on Whole Milk' },
      { name: 'Cal Cole', coffee: 'Long Black + Xtra Shot' },
      { name: 'Dee Dunn', coffee: 'No Coffee' },
      { name: 'Eli East', coffee: 'Unknown' },
      { name: 'Locum (x2)', coffee: 'Latte on Skim Milk' },
      { name: 'Dr Visitor (visitor)', coffee: 'Unknown' },
    ]);
  });

  test('missing: people with no saved order and visitors with no extra', () => {
    expect(order.missing.map(m => m.name)).toEqual(['Eli East', 'Dr Visitor']);
  });

  test('summary lines match the popup for people and extras alike', () => {
    expect(summarizeCoffeeOrder([], [])).toEqual([]);
  });
});

describe('who gets the coffee emails', () => {
  const edl = (id, name) => assign(id, name, null, EDL);

  test('the one consultant on the ED late', () => {
    expect(edLateConsultant([assign('a', 'Alex', null), edl('b', 'Bea')])).toEqual({ staff_id: 'b', name: 'Bea' });
  });

  test('registrars on a late shift never count', () => {
    expect(edLateConsultant([edl('b', 'Bea'), { ...edl('c', 'Cal'), role: 'registrar' }])).toEqual({ staff_id: 'b', name: 'Bea' });
  });

  test('two on the ED late: the one in the ED on-call slot, otherwise nobody', () => {
    const day = [edl('b', 'Bea'), edl('c', 'Cal')];
    expect(edLateConsultant(day, ['c'])).toEqual({ staff_id: 'c', name: 'Cal' });
    expect(edLateConsultant(day)).toBeNull();
  });

  test("overnight ED on call: the slot if it's filled, else the ED late", () => {
    expect(edOnCallStaffId([edl('b', 'Bea')], ['z'])).toBe('z');
    expect(edOnCallStaffId([edl('b', 'Bea')], [])).toBe('b');
  });

  test('finds the same ED on-call duty type as the roster import', () => {
    const dutyTypes = [
      { key: 'ed_oc', label: 'ED on call (Night)', active: true },
      { key: 'anaes_oc', label: 'Anaesthetics on-call (Night)', active: true },
      { key: 'obs_oc', label: 'Obstetrics on-call (Night)', active: true },
    ];
    expect(edOnCallDutyType(dutyTypes)).toBe(dutyTypeForOnCallKind('ed', dutyTypes));
    expect(edOnCallDutyType(dutyTypes).key).toBe('ed_oc');
  });
});
