// Whether { day, month } is a birthday on `date` (local time). A 29
// February birthday counts as 28 February in other years — the same rule
// as birthdays_today() in migrations/2026-11-06b_birthdays.sql.
export function isBirthdayOn(birthday, date = new Date()) {
  if (!birthday) return false;
  const day = date.getDate();
  const month = date.getMonth() + 1;
  if (birthday.day === day && birthday.month === month) return true;
  const year = date.getFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return !leap && month === 2 && day === 28 && birthday.month === 2 && birthday.day === 29;
}

// "Anika", "Anika and Sam", "Anika, Sam and Lee": first names, without a
// Dr / Prof title, for the coffee run's birthday message.
export function birthdayFirstNames(names) {
  const first = names.map(n => (n || '').replace(/^\s*(dr|prof|a\/prof)\.?\s+/i, '').trim().split(/\s+/)[0]).filter(Boolean);
  if (first.length <= 1) return first[0] || '';
  return `${first.slice(0, -1).join(', ')} and ${first[first.length - 1]}`;
}

// "Anika: gluten free" lines for the coffee run's cake, one per birthday
// person with a dietary need ([] if none).
export function birthdayDietNotes(people) {
  return people
    .map(p => ({ name: birthdayFirstNames([p.name]), diet: [p.dairy_free && 'dairy free', p.gluten_free && 'gluten free'].filter(Boolean).join(' and ') }))
    .filter(p => p.diet)
    .map(p => `${p.name}: ${p.diet}`);
}
