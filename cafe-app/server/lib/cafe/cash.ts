import {
  assertSourcedOrCalculated,
  derive,
  type CalculatedNumber,
  type TaggedNumber,
  type Source,
  type TaggedValue,
} from "./provenance";
import {
  decimal,
  decimalNumber,
  firstBreakEvenOrdersPerDay,
  multiply,
  postedPaise,
  subtract,
  sumDecimals,
  type Decimal,
} from "./cash-math";

export { calculateMeasure } from "./provenance";
export type CashMeasure = TaggedNumber | CalculatedNumber;

const levels = ["low", "base", "high"] as const;
export type Levels<T> = Readonly<Record<(typeof levels)[number], T>>;

export interface CashDay {
  readonly daysPerMonth: TaggedNumber;
  readonly demand: Levels<CashMeasure>;
  readonly baselineLosses: Levels<CashMeasure>;
  readonly scenarioLosses?: Levels<CashMeasure>;
}

export interface CashWage {
  readonly hourlyRate: TaggedNumber;
  readonly weekdayHoursPerDay: CashMeasure;
  readonly weekendHoursPerDay: CashMeasure;
}

export interface CashInputs {
  readonly cash: TaggedNumber;
  readonly startupCosts: readonly CashMeasure[];
  readonly recurringCosts: readonly CashMeasure[];
  readonly wages: readonly CashWage[];
  readonly price: CashMeasure;
  readonly ingredientCost: CashMeasure;
  readonly weekdays: CashDay;
  readonly weekends: CashDay;
  readonly savedCustomers: boolean;
  readonly savedCustomersSource?: Source;
  readonly passersByPerOpenDay?: CashMeasure;
}

export type Runway = Readonly<
  { kind: "finite"; months: number } | { kind: "no-burn"; months: null }
>;

type Figure = TaggedValue<number>;
type DecimalFigure = TaggedValue<Decimal>;

export interface CashOutcome {
  readonly weekdayOrdersPerDay: Figure;
  readonly weekendOrdersPerDay: Figure;
  readonly monthlyOrders: Figure;
  readonly recoveredOrdersPerMonth: Figure;
  readonly monthlyRevenue: Figure;
  readonly monthlyIngredientCost: Figure;
  readonly monthlyCash: Figure;
  readonly burn: Figure;
  readonly runway: TaggedValue<Runway>;
  readonly closingCash: readonly Figure[];
}

const horizonMonths = 6;

function post(figure: DecimalFigure): Figure {
  return derive(postedPaise(figure.value), figure);
}

function displayMoney(figure: Figure): Figure {
  if (!Number.isSafeInteger(figure.value)) throw new RangeError("Cash model amounts exceed supported precision.");
  const amount = figure.value / 100;
  if (postedPaise(decimal(Math.abs(amount))) !== Math.abs(figure.value)) {
    throw new RangeError("Cash model cannot represent the posted amount to the nearest paise.");
  }
  return derive(amount, figure);
}

function checkNonnegative(value: CashMeasure, name: string): void {
  assertSourcedOrCalculated(value, name);
  if (value.value < 0 || value.value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} must be a nonnegative number within supported precision.`);
  }
}

function validateDay(day: CashDay, name: string, maxDays: number): void {
  checkNonnegative(day.daysPerMonth, `${name} days per month`);
  if (!Number.isInteger(day.daysPerMonth.value) || day.daysPerMonth.value < 0 || day.daysPerMonth.value > maxDays) {
    throw new RangeError(`${name} days per month must be a whole number from 0 to ${maxDays}.`);
  }
  for (const level of levels) {
    const demand = day.demand[level];
    checkNonnegative(demand, `${name} ${level} daily demand`);
    const losses = day.scenarioLosses
      ? [day.baselineLosses[level], day.scenarioLosses[level]]
      : [day.baselineLosses[level]];
    for (const loss of losses) {
      checkNonnegative(loss, `${name} ${level} daily losses`);
      if (loss.value > demand.value) throw new RangeError(`${name} ${level} losses exceed daily demand.`);
    }
  }
  if (day.demand.low.value > day.demand.base.value || day.demand.base.value > day.demand.high.value) {
    throw new RangeError(`${name} demand must be ordered low, base and high.`);
  }
}

function validateInputs(input: CashInputs): void {
  checkNonnegative(input.cash, "Available cash");
  checkNonnegative(input.price, "Price per order");
  checkNonnegative(input.ingredientCost, "Ingredient cost per order");
  input.startupCosts.forEach((cost) => checkNonnegative(cost, "Startup cost"));
  input.recurringCosts.forEach((cost) => checkNonnegative(cost, "Recurring cost"));
  for (const { hourlyRate, weekdayHoursPerDay, weekendHoursPerDay } of input.wages) {
    checkNonnegative(hourlyRate, "Hourly wage");
    for (const hours of [weekdayHoursPerDay, weekendHoursPerDay]) {
      checkNonnegative(hours, "Paid hours per day");
      if (hours.value > 24) throw new RangeError("A worker cannot be paid for more than 24 hours per day.");
    }
  }
  validateDay(input.weekdays, "Weekday", 23);
  validateDay(input.weekends, "Weekend", 10);
  if (input.weekdays.daysPerMonth.value + input.weekends.daysPerMonth.value > 31) {
    throw new RangeError("Weekday and weekend days per month cannot exceed 31 together.");
  }
  if (typeof input.savedCustomers !== "boolean") throw new RangeError("Choose whether to count saved customers.");
  if (input.passersByPerOpenDay !== undefined) checkNonnegative(input.passersByPerOpenDay, "Passers-by per open day");
}

function sum(values: readonly (CashMeasure | Figure)[]): Figure {
  return derive(values.reduce((total, item) => total + item.value, 0), ...values);
}

function sumDecimalFigures(values: readonly DecimalFigure[]): DecimalFigure {
  return derive(sumDecimals(values.map(({ value }) => value)), ...values);
}

function costTotal(values: readonly CashMeasure[]): Figure {
  return post(derive(sumDecimals(values.map(({ value }) => decimal(value))), ...values));
}

const zero = decimal(0);

function perMonth(daily: DecimalFigure, days: TaggedNumber): DecimalFigure {
  return days.value === 0 ? derive(zero, days) : derive(multiply(daily.value, decimal(days.value)), daily, days);
}

function paidPerDay(rate: TaggedNumber, hours: CashMeasure): DecimalFigure {
  return hours.value === 0 ? derive(zero, hours) : derive(multiply(decimal(rate.value), decimal(hours.value)), rate, hours);
}

function displayCount(figure: DecimalFigure): Figure {
  return derive(decimalNumber(figure.value), figure);
}

function orders(day: CashDay, level: keyof Levels<unknown>, savedCustomers: boolean, assumptionSource?: Source) {
  const demand = day.demand[level];
  const baseline = day.baselineLosses[level];
  const candidate = day.scenarioLosses?.[level];
  const demandAmount = decimal(demand.value);
  if (!candidate) return { sold: derive(subtract(demandAmount, decimal(baseline.value)), demand, baseline), recovered: derive(zero) };
  const loss = savedCustomers || candidate.value > baseline.value ? candidate : baseline;
  const sold = subtract(demandAmount, decimal(loss.value));
  const recovered = baseline.value > candidate.value ? subtract(decimal(baseline.value), decimal(candidate.value)) : zero;
  const assumption = assumptionSource && baseline.value > candidate.value ? [assumptionSource] : [];
  return {
    sold: derive(sold, demand, baseline, candidate, ...assumption),
    recovered: savedCustomers ? derive(recovered, baseline, candidate, ...assumption) : derive(zero, ...assumption),
  };
}

export function computeRunway(input: CashInputs) {
  validateInputs(input);
  const { cash, price, ingredientCost, weekdays, weekends, wages, passersByPerOpenDay, savedCustomers } = input;
  const weekdayDays = weekdays.daysPerMonth;
  const weekendDays = weekends.daysPerMonth;
  const openDays = sum([weekdayDays, weekendDays]);
  const startupCents = costTotal(input.startupCosts);
  const recurringCents = costTotal(input.recurringCosts);
  const weekdayStaffCents = post(perMonth(sumDecimalFigures(wages.map((wage) => paidPerDay(wage.hourlyRate, wage.weekdayHoursPerDay))), weekdayDays));
  const weekendStaffCents = post(perMonth(sumDecimalFigures(wages.map((wage) => paidPerDay(wage.hourlyRate, wage.weekendHoursPerDay))), weekendDays));
  const staffCents = sum([weekdayStaffCents, weekendStaffCents]);
  const fixedCents = sum([recurringCents, staffCents]);
  const fixed = displayMoney(fixedCents);
  const openingCents = derive(postedPaise(decimal(cash.value)) - startupCents.value, cash, startupCents);
  const priceAmount = decimal(price.value);
  const ingredientAmount = decimal(ingredientCost.value);
  const contribution = derive(decimalNumber(subtract(priceAmount, ingredientAmount)), price, ingredientCost);
  const requiredOrders = firstBreakEvenOrdersPerDay(priceAmount, ingredientAmount, fixedCents.value, openDays.value);
  const breakEvenOrdersPerDay = derive(
    requiredOrders, fixed, contribution, openDays,
  );
  const requiredCaptureRate = passersByPerOpenDay === undefined ? null : derive(
    breakEvenOrdersPerDay.value === null || passersByPerOpenDay.value === 0 ? null : breakEvenOrdersPerDay.value / passersByPerOpenDay.value,
    breakEvenOrdersPerDay, passersByPerOpenDay,
  );
  const illustrativeCaptureRates = passersByPerOpenDay === undefined && requiredOrders !== null
    ? [100, 250, 500].map((count) => ({
      passersByPerOpenDay: { value: count, tag: "illustrative" as const },
      rate: { value: requiredOrders / count, tag: "illustrative" as const },
    }))
    : [];

  function project(level: keyof Levels<unknown>, countSaved: boolean, assumptionSource?: Source): CashOutcome {
    const weekday = orders(weekdays, level, countSaved, assumptionSource);
    const weekend = orders(weekends, level, countSaved, assumptionSource);
    const monthlyOrders = sumDecimalFigures([perMonth(weekday.sold, weekdayDays), perMonth(weekend.sold, weekendDays)]);
    const recovered = sumDecimalFigures([perMonth(weekday.recovered, weekdayDays), perMonth(weekend.recovered, weekendDays)]);
    const revenueCents = post(derive(multiply(monthlyOrders.value, priceAmount), monthlyOrders, price));
    const ingredientCents = post(derive(multiply(monthlyOrders.value, ingredientAmount), monthlyOrders, ingredientCost));
    const monthlyCents = derive(revenueCents.value - ingredientCents.value - fixedCents.value, revenueCents, ingredientCents, fixedCents);
    const burnCents = derive(Math.max(0, -monthlyCents.value), monthlyCents);
    const months = openingCents.value < 0 || (openingCents.value === 0 && burnCents.value > 0)
      ? 0
      : burnCents.value === 0 ? null : Math.round(openingCents.value / burnCents.value * 10) / 10;
    let balanceCents = openingCents.value;
    const closingCash = [displayMoney(openingCents), ...Array.from({ length: horizonMonths }, () => {
      balanceCents += monthlyCents.value;
      return displayMoney(derive(balanceCents, openingCents, monthlyCents));
    })];
    return {
      weekdayOrdersPerDay: displayCount(weekday.sold),
      weekendOrdersPerDay: displayCount(weekend.sold),
      monthlyOrders: displayCount(monthlyOrders),
      recoveredOrdersPerMonth: displayCount(recovered),
      monthlyRevenue: displayMoney(revenueCents),
      monthlyIngredientCost: displayMoney(ingredientCents),
      monthlyCash: displayMoney(monthlyCents),
      burn: displayMoney(burnCents),
      runway: derive<Runway>(months === null ? { kind: "no-burn", months } : { kind: "finite", months }, openingCents, burnCents),
      closingCash,
    };
  }

  function sensitivity(level: keyof Levels<unknown>) {
    const off = project(level, false);
    const on = project(level, true);
    return { off, on };
  }
  const low = sensitivity("low");
  const base = sensitivity("base");
  const high = sensitivity("high");

  return {
    breakEvenOrdersPerDay,
    requiredCaptureRate,
    illustrativeCaptureRates,
    contributionPerOrder: contribution,
    costs: {
      startup: displayMoney(startupCents),
      recurring: displayMoney(recurringCents),
      staff: displayMoney(staffCents),
      weekdayStaff: displayMoney(weekdayStaffCents),
      weekendStaff: displayMoney(weekendStaffCents),
      recurringIncludingStaff: fixed,
    },
    outcomes: {
      low: project("low", savedCustomers, input.savedCustomersSource),
      base: project("base", savedCustomers, input.savedCustomersSource),
      high: project("high", savedCustomers, input.savedCustomersSource),
    },
    assumptions: { weekdayDays, weekendDays, horizonMonths },
    savedCustomersAssumption: {
      input: "savedCustomers" as const,
      label: "Customers who would have left place an order",
      enabled: savedCustomers,
      monthlyCash: {
        low: { off: low.off.monthlyCash, on: low.on.monthlyCash },
        base: { off: base.off.monthlyCash, on: base.on.monthlyCash },
        high: { off: high.off.monthlyCash, on: high.on.monthlyCash },
      },
    },
  };
}

export type CashResult = ReturnType<typeof computeRunway>;
