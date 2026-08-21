// Coffee preference is stored as a single free-text `staff.coffee_order`
// column (pre-existing, also shown as-is in the staff detail popup) — these
// helpers compose/parse it as "<Coffee Type> - <Milk Type>" so the
// structured Coffee Type/Milk Type pickers can read and write that same
// column without a schema change.

export const NO_COFFEE = 'No Coffee';
export const NO_MILK = 'No Milk';

export const COFFEE_TYPES = ['No Coffee', 'Cappuccino', 'Flat White', 'Latte', 'Espresso', 'Long Black', 'Iced Latte'];
export const MILK_TYPES = ['Whole Milk', 'Skim Milk', 'Oat Milk', 'Almond Milk'];

// Espresso and Long Black are always taken black.
const BLACK_ONLY_TYPES = new Set(['Espresso', 'Long Black']);

export function milkIsFixedForCoffeeType(coffeeType) {
  return BLACK_ONLY_TYPES.has(coffeeType);
}

export function composeCoffeeOrder(coffeeType, milkType) {
  if (!coffeeType || coffeeType === NO_COFFEE) return NO_COFFEE;
  if (milkIsFixedForCoffeeType(coffeeType)) return `${coffeeType} - ${NO_MILK}`;
  return milkType ? `${coffeeType} - ${milkType}` : coffeeType;
}

// Parses a stored `coffee_order` string back into { coffeeType, milkType }.
// Free-text values that predate this feature (or don't match a known
// option) fall back to "No Coffee" rather than guessing.
export function parseCoffeeOrder(value) {
  if (!value || value === NO_COFFEE) return { coffeeType: NO_COFFEE, milkType: null };

  const [rawType, rawMilk] = value.split(' - ').map(s => s?.trim());
  const coffeeType = COFFEE_TYPES.includes(rawType) ? rawType : NO_COFFEE;
  if (coffeeType === NO_COFFEE) return { coffeeType: NO_COFFEE, milkType: null };

  if (milkIsFixedForCoffeeType(coffeeType)) return { coffeeType, milkType: NO_MILK };

  const milkType = MILK_TYPES.includes(rawMilk) ? rawMilk : MILK_TYPES[0];
  return { coffeeType, milkType };
}
