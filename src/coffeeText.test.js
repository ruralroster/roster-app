import { COFFEE_TEXT_VARIANTS, pickCoffeeTextVariant, coffeeTextMessage } from './coffeeText';

describe('coffee text wordings', () => {
  it('has ten, each with both handovers keeping the times', () => {
    expect(COFFEE_TEXT_VARIANTS).toHaveLength(10);
    COFFEE_TEXT_VARIANTS.forEach(v => {
      expect(v.pickup).toMatch(/10:25/);
      expect(v.delivery).toMatch(/10:30/);
    });
    expect(new Set(COFFEE_TEXT_VARIANTS.map(v => v.opening)).size).toBe(10);
  });
  it('never picks the same wording twice in a row', () => {
    expect(pickCoffeeTextVariant(3, () => 0.35)).not.toBe(3);
  });
  it('writes the order into the text', () => {
    const text = coffeeTextMessage(1, ['2 x Flat White - Full Cream'], 'pickup');
    expect(text).toMatch(/^Morning!/);
    expect(text).toMatch(/2 x Flat White/);
    expect(text).toMatch(/10:25/);
  });
});
