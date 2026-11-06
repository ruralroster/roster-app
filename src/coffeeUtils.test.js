import { coffeeAttention, parseCoffeeOrder, NO_COFFEE } from './coffeeUtils';

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

describe('parseCoffeeOrder', () => {
  it('takes a picker-saved order as written, even a drink not in the list', () => {
    expect(parseCoffeeOrder('Mocha - Oat Milk')).toEqual({ coffeeType: 'Mocha', milkType: 'Oat Milk', extraShot: false });
    expect(parseCoffeeOrder('Chai Latte - Soy Milk + Xtra Shot')).toEqual({ coffeeType: 'Chai Latte', milkType: 'Soy Milk', extraShot: true });
  });

  it('keeps black-only coffees black', () => {
    expect(parseCoffeeOrder('Long Black - No Milk')).toEqual({ coffeeType: 'Long Black', milkType: 'No Milk', extraShot: false });
  });

  it("doesn't guess at old free text", () => {
    expect(parseCoffeeOrder('flat white 2 sugars')).toEqual({ coffeeType: 'No Coffee', milkType: null, extraShot: false });
    expect(parseCoffeeOrder('No Coffee')).toEqual({ coffeeType: 'No Coffee', milkType: null, extraShot: false });
    expect(parseCoffeeOrder('')).toEqual({ coffeeType: 'No Coffee', milkType: null, extraShot: false });
  });
});
