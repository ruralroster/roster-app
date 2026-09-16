import { COFFEE_TYPES, MILK_TYPES, NO_COFFEE, NO_MILK, milkIsFixedForCoffeeType, composeCoffeeOrder, parseCoffeeOrder } from './coffeeUtils';

// Coffee Type + Milk Type dropdown pair, plus an Xtra Shot checkbox. Milk is
// disabled entirely for "No Coffee", and locked to "No Milk" for
// Espresso/Long Black (both taken black) — `value`/`onSave` read and write
// the same composed "<Coffee Type> - <Milk Type>" string as before (with an
// optional " + Xtra Shot" suffix), via coffeeUtils.
export default function CoffeePicker({ value, disabled, onSave }) {
  const { coffeeType, milkType, extraShot } = parseCoffeeOrder(value);
  const milkFixed = milkIsFixedForCoffeeType(coffeeType);
  const milkDisabled = disabled || coffeeType === NO_COFFEE;
  const extraShotDisabled = disabled || coffeeType === NO_COFFEE;

  const handleCoffeeTypeChange = (newType) => {
    let newMilk = milkType;
    if (newType === NO_COFFEE) newMilk = null;
    else if (milkIsFixedForCoffeeType(newType)) newMilk = NO_MILK;
    else if (!newMilk || newMilk === NO_MILK) newMilk = MILK_TYPES[0];
    onSave(composeCoffeeOrder(newType, newMilk, newType === NO_COFFEE ? false : extraShot));
  };

  const handleMilkTypeChange = (newMilk) => {
    onSave(composeCoffeeOrder(coffeeType, newMilk, extraShot));
  };

  const handleExtraShotChange = (newExtraShot) => {
    onSave(composeCoffeeOrder(coffeeType, milkType, newExtraShot));
  };

  return (
    <div className="flex items-center gap-1">
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
      <label className={`flex items-center gap-1 text-sm whitespace-nowrap ${extraShotDisabled ? 'text-gray-400' : 'text-gray-700'}`}>
        <input
          type="checkbox"
          checked={extraShot}
          disabled={extraShotDisabled}
          onChange={(e) => handleExtraShotChange(e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-50"
        />
        Xtra shot
      </label>
    </div>
  );
}
