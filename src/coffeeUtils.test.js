import { coffeeAttention, NO_COFFEE } from './coffeeUtils';

const staff = (id, name, coffee_order) => ({ staff_id: id, name, rank: 'SMO', coffee_order });

describe('coffeeAttention', () => {
  it('flags rostered people with no coffee order saved, but not a known "No Coffee"', () => {
    const list = coffeeAttention({
      rostered: [staff('a', 'Ann', null), staff('b', 'Ben', ''), staff('c', 'Cy', NO_COFFEE), staff('d', 'Di', 'Latte - Oat Milk')],
      visitorNames: [],
    });
    expect(list.map(i => i.name)).toEqual(['Ann', 'Ben']);
    expect(list[0]).toMatchObject({ kind: 'staff', staff_id: 'a' });
  });

  it('flags visitors on today\'s cards once each, whatever the spelling of the repeat', () => {
    const list = coffeeAttention({ rostered: [], visitorNames: ['Dr Smith', 'dr smith ', 'Dr Jones'] });
    expect(list.map(i => i.name)).toEqual(['Dr Smith', 'Dr Jones']);
    expect(list.every(i => i.kind === 'visitor')).toBe(true);
  });

  it('leaves out anyone already on the list as an extra, by name', () => {
    const list = coffeeAttention({
      rostered: [staff('a', 'Ann', null)],
      visitorNames: ['Dr Smith', 'Dr Jones'],
      extras: [{ label: 'ann' }, { label: 'Dr Smith' }],
    });
    expect(list.map(i => i.name)).toEqual(['Dr Jones']);
  });

  it('leaves out someone taken off today\'s list on purpose', () => {
    const list = coffeeAttention({ rostered: [staff('a', 'Ann', null)], visitorNames: [], removedStaffIds: ['a'] });
    expect(list).toEqual([]);
  });
});
