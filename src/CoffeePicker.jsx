import { COFFEE_TYPES, MILK_TYPES, NO_COFFEE, NO_MILK, milkIsFixedForCoffeeType, composeCoffeeOrder, parseCoffeeOrder } from './coffeeUtils';

// Coffee Type + Milk Type dropdown pair. Milk is disabled entirely for "No
// Coffee", and locked to "No Milk" for Espresso/Long Black (both taken
// black) — `value`/`onSave` read and write the same composed
// "<Coffee Type> - <Milk Type>" string as before, via coffeeUtils.
export default function CoffeePicker({ value, disabled, onSave }) {
  const { coffeeType, milkType } = parseCoffeeOrder(value);
  const milkFixed = milkIsFixedForCoffeeType(coffeeType);
  const milkDisabled = disabled || coffeeType === NO_COFFEE;

  const handleCoffeeTypeChange = (newType) => {
    let newMilk = milkType;
    if (newType === NO_COFFEE) newMilk = null;
    else if (milkIsFixedForCoffeeType(newType)) newMilk = NO_MILK;
    else if (!newMilk || newMilk === NO_MILK) newMilk = MILK_TYPES[0];
    onSave(composeCoffeeOrder(newType, newMilk));
  };

  const handleMilkTypeChange = (newMilk) => {
    onSave(composeCoffeeOrder(coffeeType, newMilk));
  };

  return (
    <div className="flex gap-1">
      <select
        value={coffeeType}
        disabled={disabled}
        onChange={(e) => handleCoffeeTypeChange(e.target.value)}
        className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
      >
        {COFFEE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select
        value={coffeeType === NO_COFFEE ? '' : (milkFixed ? NO_MILK : milkType)}
        disabled={milkDisabled || milkFixed}
        onChange={(e) => handleMilkTypeChange(e.target.value)}
        className="px-2 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
      >
        {coffeeType === NO_COFFEE ? (
          <option value="">—</option>
        ) : milkFixed ? (
          <option value={NO_MILK}>{NO_MILK}</option>
        ) : (
          MILK_TYPES.map(m => <option key={m} value={m}>{m}</option>)
        )}
      </select>
    </div>
  );
}
