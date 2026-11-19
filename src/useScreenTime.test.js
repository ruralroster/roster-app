import { screenCounts } from './useScreenTime';

describe('screen time', () => {
  it('counts only a screen in front and used in the last two minutes', () => {
    const now = 1_000_000;
    expect(screenCounts(now, now - 30_000, true)).toBe(true);
    expect(screenCounts(now, now - 3 * 60_000, true)).toBe(false); // left open
    expect(screenCounts(now, now - 30_000, false)).toBe(false); // another tab in front
  });
});
