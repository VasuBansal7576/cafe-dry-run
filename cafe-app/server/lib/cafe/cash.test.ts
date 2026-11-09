import { describe, expect, it } from "vitest";
import { calculateMeasure, computeRunway, type CashInputs, type Levels } from "./cash";
import {
  assertTaggedNumber,
  derive,
  weakestTag,
  type Source,
  type SourceTag,
  type TaggedNumber,
} from "./provenance";

const observed = (value: number): TaggedNumber => ({ value, source: { tag: "observed" } });
const estimate = (value: number): TaggedNumber => ({ value, source: { tag: "estimate" } });
const illustrative = (value: number): TaggedNumber => ({ value, source: { tag: "illustrative" } });
const range = (low: number, base: number, high: number): Levels<TaggedNumber> => ({
  low: observed(low), base: observed(base), high: observed(high),
});

function founderInputs(): CashInputs {
  return {
    cash: observed(6000),
    startupCosts: [estimate(600), observed(400)],
    recurringCosts: [observed(1800), observed(200)],
    wages: [{
      hourlyRate: observed(100),
      weekdayHoursPerDay: observed(1),
      weekendHoursPerDay: observed(2),
    }],
    price: observed(100),
    ingredientCost: observed(50),
    weekdays: {
      daysPerMonth: observed(20),
      demand: range(2, 4, 8),
      baselineLosses: range(0, 1, 2),
    },
    weekends: {
      daysPerMonth: observed(8),
      demand: range(4, 10, 20),
      baselineLosses: range(0, 4, 8),
    },
    savedCustomers: false,
  };
}

function oneDayLedger(price: number, ingredients: number, fixed: number, dailyOrders = 1): CashInputs {
  const original = founderInputs();
  return {
    ...original,
    cash: observed(100),
    startupCosts: [],
    recurringCosts: [observed(fixed)],
    wages: [],
    price: observed(price),
    ingredientCost: observed(ingredients),
    weekdays: { daysPerMonth: observed(1), demand: range(dailyOrders, dailyOrders, dailyOrders), baselineLosses: range(0, 0, 0) },
    weekends: { ...original.weekends, daysPerMonth: observed(0) },
  };
}

describe("cash ledger", () => {
  it("uses distinct weekday and weekend demand, staffing and losses, and pays startup once", () => {
    const result = computeRunway(founderInputs());
    expect(result.breakEvenOrdersPerDay).toEqual({ value: 4, tag: "observed" });
    expect(result.costs.startup.value).toBe(1000);
    expect(result.costs.recurring.value).toBe(2000);
    expect(result.costs.staff.value).toBe(3600);
    expect(result.outcomes.base.weekdayOrdersPerDay.value).toBe(3);
    expect(result.outcomes.base.weekendOrdersPerDay.value).toBe(6);
    expect(result.outcomes.base.monthlyOrders.value).toBe(108);
    expect(result.outcomes.base.monthlyRevenue.value).toBe(10800);
    expect(result.outcomes.base.monthlyIngredientCost.value).toBe(5400);
    expect(result.outcomes.base.monthlyCash.value).toBe(-200);
    expect(result.outcomes.base.burn.value).toBe(200);
    expect(result.outcomes.base.closingCash.slice(0, 3).map(({ value }) => value)).toEqual([5000, 4800, 4600]);
  });

  it("shows finite and no-burn outcomes under the supplied low, base and high assumptions", () => {
    const { outcomes } = computeRunway(founderInputs());
    expect(outcomes.low.monthlyCash.value).toBe(-2000);
    expect(outcomes.low.runway.value).toEqual({ kind: "finite", months: 2.5 });
    expect(outcomes.base.runway.value).toEqual({ kind: "finite", months: 25 });
    expect(outcomes.high.monthlyCash.value).toBe(5200);
    expect(outcomes.high.burn.value).toBe(0);
    expect(outcomes.high.runway.value).toEqual({ kind: "no-burn", months: null });
    const underfunded = computeRunway({ ...founderInputs(), cash: observed(900) });
    expect(underfunded.outcomes.high.closingCash[0]?.value).toBe(-100);
    expect(underfunded.outcomes.high.runway.value).toEqual({ kind: "finite", months: 0 });
  });

  it("only adds revenue when the switch is on and comparable simulation losses fell", () => {
    const original = founderInputs();
    const option: CashInputs = {
      ...original,
      weekends: { ...original.weekends, scenarioLosses: range(0, 1, 8) },
      wages: [...original.wages, {
        hourlyRate: observed(100), weekdayHoursPerDay: observed(0), weekendHoursPerDay: observed(1),
      }],
    };
    const off = computeRunway(option);
    const on = computeRunway({ ...option, savedCustomers: true });
    expect(off.outcomes.base.monthlyOrders.value).toBe(108);
    expect(on.outcomes.base.monthlyOrders.value).toBe(132);
    expect(on.outcomes.low.recoveredOrdersPerMonth.value).toBe(0);
    expect(on.outcomes.high.recoveredOrdersPerMonth.value).toBe(0);
    expect(off.outcomes.base.monthlyCash.value).toBe(-1000);
    expect(on.outcomes.base.monthlyCash.value).toBe(200);
    expect(on.savedCustomersAssumption.input).toBe("savedCustomers");
    expect(on.savedCustomersAssumption.monthlyCash.base.off.value).toBe(-1000);
    expect(on.savedCustomersAssumption.monthlyCash.base.on.value).toBe(200);
    const worse = computeRunway({
      ...original,
      weekends: { ...original.weekends, scenarioLosses: range(0, 5, 8) },
    });
    expect(worse.outcomes.base.monthlyOrders.value).toBe(100);
  });

  it("makes break-even and the capture rate conditional on open days, margin and a pedestrian count", () => {
    const original = founderInputs();
    expect(computeRunway(original).requiredCaptureRate).toBeNull();
    expect(computeRunway(original).illustrativeCaptureRates[0]).toEqual({
      passersByPerOpenDay: { value: 100, tag: "illustrative" },
      rate: { value: 0.04, tag: "illustrative" },
    });
    const result = computeRunway({ ...original, passersByPerOpenDay: observed(50) });
    expect(result.requiredCaptureRate?.value).toBeCloseTo(0.08);
    const noMargin = computeRunway({ ...original, ingredientCost: observed(100) });
    expect(noMargin.breakEvenOrdersPerDay.value).toBeNull();
    const noOpenDays = computeRunway({
      ...original,
      weekdays: { ...original.weekdays, daysPerMonth: observed(0) },
      weekends: { ...original.weekends, daysPerMonth: observed(0) },
    });
    expect(noOpenDays.breakEvenOrdersPerDay.value).toBeNull();
    expect(noOpenDays.outcomes.base.monthlyCash.value).toBe(-2000);
  });

  it("does not add an order at an exact break-even threshold with decimal prices", () => {
    const original = founderInputs();
    const result = computeRunway({
      ...original,
      recurringCosts: [observed(0.2)],
      wages: [],
      price: observed(0.3),
      ingredientCost: observed(0.2),
      weekdays: { ...original.weekdays, daysPerMonth: observed(2) },
      weekends: { ...original.weekends, daysPerMonth: observed(0) },
    });
    expect(result.breakEvenOrdersPerDay.value).toBe(1);
    expect(result.outcomes.base.monthlyCash.value).toBe(0.4);
  });

  it("keeps sub-paise weighted margin until it aggregates orders", () => {
    const original = founderInputs();
    const result = computeRunway({
      ...original,
      recurringCosts: [observed(0.4)],
      wages: [],
      price: calculateMeasure(100.004, observed(100), observed(101)),
      ingredientCost: observed(100),
    });
    expect(result.breakEvenOrdersPerDay.value).toBe(4);
    expect(result.outcomes.base.monthlyCash.value).toBe(0.03);
  });

  it("uses the posted amounts for monthly cash, burn and the cash series", () => {
    const result = computeRunway(oneDayLedger(10.004, 5.006, 4.99));
    const { base } = result.outcomes;
    expect(base.monthlyOrders.value).toBe(1);
    expect(base.monthlyRevenue.value).toBe(10);
    expect(base.monthlyIngredientCost.value).toBe(5.01);
    expect(result.costs.recurringIncludingStaff.value).toBe(4.99);
    expect(base.monthlyCash.value).toBe(0);
    expect(base.burn.value).toBe(0);
    expect(base.runway.value).toEqual({ kind: "no-burn", months: null });
    expect(base.closingCash.map(({ value }) => value)).toEqual([100, 100, 100, 100, 100, 100, 100]);
  });

  it.each([
    [10.075, 5.005, 5.07, 10.08, 5.01],
    [10.006, 5.004, 5.01, 10.01, 5],
  ])("uses the posted ledger to find break-even for a ₹%s order", (price, ingredients, fixed, revenue, cost) => {
    const { outcomes: { base }, breakEvenOrdersPerDay } = computeRunway(oneDayLedger(price, ingredients, fixed));
    expect(base.monthlyRevenue.value).toBe(revenue);
    expect(base.monthlyIngredientCost.value).toBe(cost);
    expect(base.monthlyCash.value).toBe(0);
    expect(breakEvenOrdersPerDay.value).toBe(1);
  });

  it("starts at zero orders when there are no fixed costs and selling would lose money", () => {
    const atZero = computeRunway(oneDayLedger(9, 10, 0, 0));
    const atOne = computeRunway(oneDayLedger(9, 10, 0, 1));
    expect(atZero.outcomes.base.monthlyCash.value).toBe(0);
    expect(atOne.outcomes.base.monthlyCash.value).toBe(-1);
    expect(atZero.breakEvenOrdersPerDay.value).toBe(0);
  });

  it("finds the first break-even volume when rounded cash can dip again", () => {
    const resultAt = (dailyOrders: number) => computeRunway(oneDayLedger(0.008, 0.006, 0.01, dailyOrders));
    const second = resultAt(2);
    expect(resultAt(1).outcomes.base.monthlyCash.value).toBe(-0.01);
    expect(second.outcomes.base.monthlyCash.value).toBe(0);
    expect(resultAt(3).outcomes.base.monthlyCash.value).toBe(-0.01);
    expect(second.breakEvenOrdersPerDay.value).toBe(2);
  });

  it("finds a narrow-margin threshold before the unrounded estimate exceeds supported order counts", () => {
    const threshold = 5_000_000_000_000_000;
    const resultAt = (dailyOrders: number) => computeRunway(oneDayLedger(1e-18, 0, 0.01, dailyOrders));
    expect(resultAt(threshold - 1).outcomes.base.monthlyCash.value).toBe(-0.01);
    const atThreshold = resultAt(threshold);
    expect(atThreshold.outcomes.base.monthlyCash.value).toBe(0);
    expect(atThreshold.breakEvenOrdersPerDay.value).toBe(threshold);
    expect(() => computeRunway(oneDayLedger(1e-19, 0, 0.01))).toThrow(/Break-even orders exceed supported precision/);
  });

  it("posts half-paise ties after aggregating fractional orders and cost inputs", () => {
    const input = oneDayLedger(0.05, 0, 0, 10.1);
    const result = computeRunway({
      ...input,
      startupCosts: [observed(10.075)],
      recurringCosts: [observed(0.004), observed(0.051)],
      wages: [{ hourlyRate: observed(0.2), weekdayHoursPerDay: observed(0.725), weekendHoursPerDay: observed(0) }],
      weekdays: { ...input.weekdays, baselineLosses: range(10, 10, 10) },
    });
    expect(result.costs.startup.value).toBe(10.08);
    expect(result.costs.recurring.value).toBe(0.06);
    expect(result.costs.staff.value).toBe(0.15);
    expect(result.outcomes.base.monthlyOrders.value).toBe(0.1);
    expect(result.outcomes.base.monthlyRevenue.value).toBe(0.01);
    expect(result.outcomes.base.monthlyCash.value).toBe(-0.20);
  });

  it("rejects a closing balance that would lose a paise when displayed", () => {
    const cash = observed(70_368_744_177_664.03);
    const breakEven = computeRunway({ ...oneDayLedger(0.01, 0, 0.01), cash });
    expect(breakEven.outcomes.base.closingCash[2]?.value).toBe(cash.value);
    expect(() => computeRunway({ ...oneDayLedger(0.01, 0, 0.02), cash })).toThrow(
      /cannot represent the posted amount to the nearest paise/,
    );
  });

  it("rejects inconsistent demand, losses, days and financial inputs", () => {
    const original = founderInputs();
    expect(() => computeRunway({ ...original, cash: observed(NaN) })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, startupCosts: [observed(-1)] })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, weekdays: { ...original.weekdays, demand: range(5, 4, 8) } })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, weekdays: { ...original.weekdays, daysPerMonth: observed(25) } })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, weekdays: { ...original.weekdays, daysPerMonth: observed(20.5) } })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, weekends: { ...original.weekends, baselineLosses: range(5, 4, 8) } })).toThrow(RangeError);
  });
});

describe("provenance", () => {
  it("propagates the weakest actual dependency and doesn't drag demand into break-even", () => {
    const original = founderInputs();
    const result = computeRunway({
      ...original,
      weekends: {
        ...original.weekends,
        baselineLosses: { ...original.weekends.baselineLosses, base: illustrative(4) },
      },
    });
    expect(result.breakEvenOrdersPerDay.tag).toBe("observed");
    expect(result.costs.startup.tag).toBe("estimate");
    expect(result.outcomes.high.monthlyCash.tag).toBe("observed");
    expect(result.outcomes.base.monthlyCash.tag).toBe("illustrative");
    expect(result.outcomes.base.runway.tag).toBe("illustrative");
    expect(result.outcomes.high.closingCash[0]?.tag).toBe("estimate");
    expect(result.outcomes.base.closingCash[0]?.tag).toBe("estimate");
    const strongestToWeakest: SourceTag[] = ["observed", "public", "estimate", "illustrative"];
    for (const [index, tag] of strongestToWeakest.entries()) {
      for (const stronger of strongestToWeakest.slice(0, index + 1)) {
        expect(weakestTag([{ tag }, { tag: stronger }])).toBe(tag);
        expect(weakestTag([{ tag: stronger }, { tag }])).toBe(tag);
      }
    }
    expect(derive(12, estimate(5), observed(7))).toEqual({ value: 12, tag: "estimate" });
  });

  it("requires public inputs to carry a URL, valid retrieval date and supporting value", () => {
    const source = { tag: "public", url: "https://example.com/spec", retrievedAt: "2026-11-09", supportingValue: "₹100 / order" } as const;
    const original = founderInputs();
    expect(() => assertTaggedNumber({ value: 100, source })).not.toThrow();
    expect(() => assertTaggedNumber({ value: 100, source: { tag: "public" } })).toThrow(RangeError);
    expect(() => assertTaggedNumber({ value: 100, source: { ...source, url: "file:///spec" } })).toThrow(RangeError);
    expect(() => assertTaggedNumber({ value: 100, source: { ...source, retrievedAt: "2026-02-30" } })).toThrow(RangeError);
    expect(() => computeRunway({ ...original, price: { value: 100, source: { ...source, supportingValue: "" } } })).toThrow(RangeError);
    expect(computeRunway({ ...original, price: { value: 100, source } }).breakEvenOrdersPerDay.tag).toBe("public");
    const weightedPrice = calculateMeasure(80, source, observed(50));
    expect(computeRunway({ ...original, price: weightedPrice }).contributionPerOrder).toEqual({ value: 30, tag: "public" });
  });

  it.each([
    ["a bare public tag", { tag: "public" } as Source],
    ["a public number with an invalid URL", { value: 100, source: { tag: "public", url: "file:///spec", retrievedAt: "2026-11-09", supportingValue: "₹100" } } satisfies TaggedNumber],
    ["a public number with no supporting value", { value: 100, source: { tag: "public", url: "https://example.com/spec", retrievedAt: "2026-11-09", supportingValue: "" } } satisfies TaggedNumber],
  ])("does not calculate a measure from %s", (_name, dependency) => {
    expect(() => calculateMeasure(80, dependency)).toThrow(/public source needs a URL, retrieval date and supporting value/);
  });

  it("accepts calculated measures as dependencies and preserves their source rank", () => {
    const publicSource = { tag: "public", url: "https://example.com/spec", retrievedAt: "2026-11-09", supportingValue: "₹100" } as const;
    const weightedPrice = calculateMeasure(80, publicSource, observed(50));
    const adjustedPrice = calculateMeasure(75, weightedPrice, observed(5));
    const result = computeRunway({ ...founderInputs(), price: adjustedPrice });
    expect(result.contributionPerOrder).toEqual({ value: 25, tag: "public" });
    expect(() => calculateMeasure(75, derive(80, publicSource) as Source)).toThrow(RangeError);
  });
});
