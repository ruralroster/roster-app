import { isBirthdayOn, birthdayFirstNames, birthdayDietNotes } from './birthdays';

test('matches day and month, any year', () => {
  expect(isBirthdayOn({ day: 6, month: 11 }, new Date(2026, 10, 6))).toBe(true);
  expect(isBirthdayOn({ day: 6, month: 11 }, new Date(2026, 10, 7))).toBe(false);
  expect(isBirthdayOn({ day: 11, month: 6 }, new Date(2026, 10, 6))).toBe(false);
  expect(isBirthdayOn(null, new Date(2026, 10, 6))).toBe(false);
});

test('29 February is celebrated on 28 February in other years', () => {
  const leapling = { day: 29, month: 2 };
  expect(isBirthdayOn(leapling, new Date(2027, 1, 28))).toBe(true);
  expect(isBirthdayOn(leapling, new Date(2028, 1, 28))).toBe(false);
  expect(isBirthdayOn(leapling, new Date(2028, 1, 29))).toBe(true);
  expect(isBirthdayOn({ day: 28, month: 2 }, new Date(2027, 1, 28))).toBe(true);
});

test('first names for the coffee birthday message', () => {
  expect(birthdayFirstNames(['Dr Anika Lin'])).toBe('Anika');
  expect(birthdayFirstNames(['Anika Lin', 'Prof. Sam Ng'])).toBe('Anika and Sam');
  expect(birthdayFirstNames(['A Lin', 'B Ng', 'C Wu'])).toBe('A, B and C');
});

test('dietary notes for the cake', () => {
  expect(birthdayDietNotes([
    { name: 'Dr Anika Lin', dairy_free: false, gluten_free: true },
    { name: 'Sam Ng', dairy_free: false, gluten_free: false },
    { name: 'Lee Wu', dairy_free: true, gluten_free: true },
  ])).toEqual(['Anika: gluten free', 'Lee: dairy free and gluten free']);
});
