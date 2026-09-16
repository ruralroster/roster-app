// Coffee preference is stored as a single free-text `staff.coffee_order`
// column (pre-existing, also shown as-is in the staff detail popup) — these
// helpers compose/parse it as "<Coffee Type> - <Milk Type>" (plus an
// optional " + Xtra Shot" suffix) so the structured Coffee Type/Milk Type
// pickers can read and write that same column without a schema change.

export const NO_COFFEE = 'No Coffee';
export const NO_MILK = 'No Milk';
export const EXTRA_SHOT_SUFFIX = ' + Xtra Shot';

export const COFFEE_TYPES = ['No Coffee', 'Cappuccino', 'Flat White', 'Latte', 'Espresso', 'Long Black', 'Iced Latte'];
export const MILK_TYPES = ['Whole Milk', 'Skim Milk', 'Oat Milk', 'Almond Milk', 'Lactose Free Milk'];

// Espresso and Long Black are always taken black.
const BLACK_ONLY_TYPES = new Set(['Espresso', 'Long Black']);

export function milkIsFixedForCoffeeType(coffeeType) {
  return BLACK_ONLY_TYPES.has(coffeeType);
}

export function composeCoffeeOrder(coffeeType, milkType, extraShot) {
  if (!coffeeType || coffeeType === NO_COFFEE) return NO_COFFEE;
  const suffix = extraShot ? EXTRA_SHOT_SUFFIX : '';
  if (milkIsFixedForCoffeeType(coffeeType)) return `${coffeeType} - ${NO_MILK}${suffix}`;
  return `${coffeeType} - ${milkType || MILK_TYPES[0]}${suffix}`;
}

// Parses a stored `coffee_order` string back into
// { coffeeType, milkType, extraShot }. Free-text values that predate this
// feature (or don't match a known option) fall back to "No Coffee" rather
// than guessing.
export function parseCoffeeOrder(value) {
  if (!value || value === NO_COFFEE) return { coffeeType: NO_COFFEE, milkType: null, extraShot: false };

  const extraShot = value.endsWith(EXTRA_SHOT_SUFFIX);
  const withoutSuffix = extraShot ? value.slice(0, -EXTRA_SHOT_SUFFIX.length) : value;

  const [rawType, rawMilk] = withoutSuffix.split(' - ').map(s => s?.trim());
  const coffeeType = COFFEE_TYPES.includes(rawType) ? rawType : NO_COFFEE;
  if (coffeeType === NO_COFFEE) return { coffeeType: NO_COFFEE, milkType: null, extraShot: false };

  if (milkIsFixedForCoffeeType(coffeeType)) return { coffeeType, milkType: NO_MILK, extraShot };

  const milkType = MILK_TYPES.includes(rawMilk) ? rawMilk : MILK_TYPES[0];
  return { coffeeType, milkType, extraShot };
}
