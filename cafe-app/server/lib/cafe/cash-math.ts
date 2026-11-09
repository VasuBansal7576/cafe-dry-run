export type Decimal = Readonly<{ units: bigint; places: number }>;

function powerOfTen(places: number): bigint {
  return 10n ** BigInt(places);
}

export function decimal(value: number): Decimal {
  const [mantissa = "", exponent = "0"] = value.toString().split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const units = BigInt(whole + fraction);
  const places = fraction.length - Number(exponent);
  return places < 0 ? { units: units * powerOfTen(-places), places: 0 } : { units, places };
}

function unitsAtScale(value: Decimal, places: number): bigint {
  return value.units * powerOfTen(places - value.places);
}

function combine(left: Decimal, right: Decimal, sign: bigint): Decimal {
  const places = Math.max(left.places, right.places);
  return { units: unitsAtScale(left, places) + sign * unitsAtScale(right, places), places };
}

export function sumDecimals(values: readonly Decimal[]): Decimal {
  return values.reduce((total, item) => combine(total, item, 1n), { units: 0n, places: 0 });
}

export function subtract(left: Decimal, right: Decimal): Decimal {
  return combine(left, right, -1n);
}

export function multiply(left: Decimal, right: Decimal): Decimal {
  return { units: left.units * right.units, places: left.places + right.places };
}

export function decimalNumber(value: Decimal): number {
  return Number(`${value.units}e-${value.places}`);
}

export function postedPaise(value: Decimal, denominator = 1): number {
  const divisor = powerOfTen(value.places) * BigInt(denominator);
  const paise = Number((value.units * 200n + divisor) / (2n * divisor));
  if (!Number.isSafeInteger(paise)) throw new RangeError("Cash model amounts exceed supported precision.");
  return paise;
}

// Sum floor((step * i + offset) / divisor) for 0 <= i < count by reducing the divisor.
function sumFloors(count: bigint, divisor: bigint, step: bigint, offset: bigint): bigint {
  let sum = 0n;
  while (true) {
    sum += ((count - 1n) * count / 2n) * (step / divisor) + count * (offset / divisor);
    step %= divisor;
    offset %= divisor;
    const end = step * count + offset;
    if (end < divisor) return sum;
    count = end / divisor;
    offset = end % divisor;
    [divisor, step] = [step, divisor];
  }
}

// The first whole daily order count whose posted month covers fixed costs.
// A tiny margin can produce a dip at a later volume until the raw margin covers costs.
export function firstBreakEvenOrdersPerDay(price: Decimal, cost: Decimal, fixedPaise: number, openDays: number): number | null {
  const places = Math.max(2, price.places, cost.places);
  const divisor = powerOfTen(places - 2);
  const revenueStep = unitsAtScale(price, places) * BigInt(openDays);
  const costStep = unitsAtScale(cost, places) * BigInt(openDays);
  const margin = revenueStep - costStep;
  if (openDays === 0) return null;
  if (fixedPaise === 0) return 0;
  if (margin <= 0n) return null;

  const belowTarget = BigInt(fixedPaise) - 1n;
  const firstPossible = belowTarget * divisor / margin + 1n;
  const guaranteed = (BigInt(fixedPaise) * divisor + margin - 1n) / margin;
  const supported = BigInt(Number.MAX_SAFE_INTEGER);
  let low = firstPossible;
  let high = guaranteed < supported ? guaranteed : supported;

  // In this interval the posted margin is at least fixedPaise - 1.
  // Summing the excess above that value counts whether any volume breaks even.
  const half = divisor / 2n;
  function hasBreakEvenThrough(last: bigint): boolean {
    const count = last - firstPossible + 1n;
    const revenue = sumFloors(count, divisor, revenueStep, revenueStep * firstPossible + half);
    const cost = sumFloors(count, divisor, costStep, costStep * firstPossible + half);
    return revenue - cost > belowTarget * count;
  }

  if (low > high || !hasBreakEvenThrough(high)) {
    throw new RangeError("Break-even orders exceed supported precision.");
  }
  while (low < high) {
    const middle = (low + high) / 2n;
    if (hasBreakEvenThrough(middle)) high = middle;
    else low = middle + 1n;
  }
  return Number(low);
}
