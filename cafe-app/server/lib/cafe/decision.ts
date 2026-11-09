import { createHash } from "node:crypto";

import { createArrivalPlan, type ArrivalPlan, type Demand } from "./arrivals";
import {
  computeRunway,
  type CashMeasure,
  type CashWage,
  type Levels,
  type MatchedWeekendSales,
} from "./cash";
import type { SavedCustomerAssumption } from "./finance";
import {
  calculateMeasure,
  derive,
  type CalculatedNumber,
  type Source,
} from "./provenance";
import {
  arrivalInputs,
  demandSources,
  pedestrianDailyArrivals,
  sampledArrivalProvenance,
  serviceInputs,
  serviceProvenance,
  serviceSources,
} from "./scenario";
import type { Scenario } from "./scenario-store";
import type { ServiceRun } from "./service-run";
import { simulateSeries, type SeriesResult } from "./simulation";

export type DecisionParameters = Pick<
  ServiceRun["summary"],
  "seed" | "runCount" | "demandLevel"
>;

export function expectedDailyArrivals(
  demand: Demand,
  level: DecisionParameters["demandLevel"],
): number {
  const openHours = (demand.hours.closesAt - demand.hours.opensAt) / 3600;
  const weightedHours = demand.hourlyMultipliers.reduce(
    (sum, multiplier, index) =>
      sum + multiplier * Math.min(1, openHours - index),
    0,
  );
  return demand.hourly[level] * weightedHours;
}

export function isServicePlanSizeAllowed(
  expectedArrivals: number,
  runCount: number,
): boolean {
  return expectedArrivals <= 3_000 && expectedArrivals * runCount <= 100_000;
}

export function summarizeService(
  scenario: Scenario,
  arrivalScenario: Scenario,
  plan: ArrivalPlan,
  result: SeriesResult,
): ServiceRun["summary"] {
  return {
    seed: plan.seed,
    runCount: plan.runs.length,
    demandLevel: plan.demandLevel,
    hours: plan.hours,
    staffNames: Object.fromEntries(
      scenario.shop.workers.map(({ id, name }) => [id, name]),
    ),
    itemNames: Object.fromEntries(
      scenario.shop.menu.map(({ id, name }) => [id, name]),
    ),
    stats: result.stats as ServiceRun["summary"]["stats"],
    arrivalProvenance: sampledArrivalProvenance(
      arrivalScenario.demand,
      plan.demandLevel,
    ),
    provenance: serviceProvenance(
      arrivalScenario.demand,
      scenario.shop,
      plan.demandLevel,
      arrivalScenario.shop.menu,
    ),
  };
}

type WeekendSample = {
  arrivals: number;
  lostA: number;
  lostB: number | null;
  lostBaseline: number;
  arrivalDigest: string;
};

function drinkEconomics(scenario: Scenario) {
  const prices = new Map(
    scenario.shop.menu.map(({ id, economics }) => [id, economics]),
  );
  return (id: string) =>
    prices.get(id) ?? {
      price: scenario.finance.averagePrice,
      ingredientCost: scenario.finance.averageIngredientCost,
    };
}

function menuEconomics(
  scenario: Scenario,
  mix: readonly { id: string; name: string; weight: CashMeasure }[],
) {
  const economics = drinkEconomics(scenario);
  const active = mix.filter(({ weight }) => weight.value > 0);
  const totalWeight = active.reduce((sum, { weight }) => sum + weight.value, 0);
  function average(key: "price" | "ingredientCost") {
    const entries = active.map(({ id, weight }) => ({
      weight,
      unit: economics(id)[key],
    }));
    return calculateMeasure(
      entries.reduce(
        (sum, { weight, unit }) => sum + weight.value * unit.value,
        0,
      ) / totalWeight,
      ...mix.map(({ weight }) => weight),
      ...entries.map(({ unit }) => unit),
    );
  }
  return {
    price: average("price"),
    ingredientCost: average("ingredientCost"),
    legacyDrinks: active
      .filter(
        ({ id }) =>
          !scenario.shop.menu.find((item) => item.id === id)?.economics,
      )
      .map(({ name }) => name),
  };
}

type MatchedCompletionCounts = {
  arrivals: number;
  source: CalculatedNumber;
  counts: ReadonlyMap<string, { common: number; recovered: number }>;
};

function matchedCompletions(
  baseline: SeriesResult,
  candidate: SeriesResult,
  arrivals: number,
  source: CalculatedNumber,
): MatchedCompletionCounts {
  const counts = new Map<string, { common: number; recovered: number }>();
  const fewerLosses =
    candidate.totals.customersLost < baseline.totals.customersLost;
  for (const [index, drinks] of candidate.completedDrinksByRun.entries()) {
    const original = baseline.completedDrinksByRun[index]!;
    for (const [itemId, completed] of drinks) {
      const common = Math.min(original.get(itemId) ?? 0, completed);
      const totals = counts.get(itemId) ?? { common: 0, recovered: 0 };
      totals.common += common;
      if (fewerLosses) totals.recovered += completed - common;
      counts.set(itemId, totals);
    }
  }
  return { arrivals, source, counts };
}

function forecast(
  scenario: Scenario,
  baseline: Scenario,
  weekendDemand: Levels<CalculatedNumber>,
  weekendLosses: Levels<CalculatedNumber>,
  completions: Levels<MatchedCompletionCounts>,
  assumption: SavedCustomerAssumption,
) {
  const finance = scenario.finance;
  const wages: CashWage[] = [
    ...Array.from({ length: finance.weekdayStaffCount.value }, () => ({
      hourlyRate: finance.hourlyWage,
      weekdayHoursPerDay: calculateMeasure(
        finance.weekdayHoursPerWorker.value,
        finance.weekdayStaffCount,
        finance.weekdayHoursPerWorker,
      ),
      weekendHoursPerDay: calculateMeasure(0),
    })),
    ...scenario.shop.workers.map(({ shifts }) => ({
      hourlyRate: finance.hourlyWage,
      weekdayHoursPerDay: calculateMeasure(0),
      weekendHoursPerDay: calculateMeasure(
        shifts.reduce(
          (seconds, shift) =>
            seconds + shift.endsAt.value - shift.startsAt.value,
          0,
        ) / 3600,
        ...shifts.flatMap(({ startsAt, endsAt }) => [startsAt, endsAt]),
      ),
    })),
  ];
  if (finance.weekdayStaffCount.value === 0) {
    wages.push({
      hourlyRate: finance.hourlyWage,
      weekdayHoursPerDay: calculateMeasure(0, finance.weekdayStaffCount),
      weekendHoursPerDay: calculateMeasure(0),
    });
  }
  const weekdayLoss = (level: DecisionParameters["demandLevel"]) => {
    const demand = finance.weekdayDemand[level];
    return calculateMeasure(
      demand.value * (finance.weekdayLossPercent.value / 100),
      demand,
      finance.weekdayLossPercent,
    );
  };
  const weekdayEconomics = menuEconomics(scenario, scenario.shop.menu);
  const economics = drinkEconomics(scenario);
  function matchedSales({
    counts,
    arrivals,
    source,
  }: MatchedCompletionCounts): MatchedWeekendSales {
    return {
      arrivals,
      tag: source.tag,
      drinks: [...counts].map(([id, count]) => ({
        ...count,
        ...economics(id),
      })),
    };
  }
  const matchedWeekendSales = {
    low: matchedSales(completions.low),
    base: matchedSales(completions.base),
    high: matchedSales(completions.high),
  };
  const { counts, source } = completions.base;
  const assumptionSource = { tag: assumption.tag };
  const hasRecovery = [...counts.values()].some(
    ({ recovered }) => recovered > 0,
  );
  const completedMix = baseline.shop.menu.flatMap(({ id, name }) => {
    const drink = counts.get(id);
    const sold =
      (drink?.common ?? 0) + (assumption.enabled ? (drink?.recovered ?? 0) : 0);
    return sold > 0
      ? [
          {
            id,
            name,
            weight: calculateMeasure(
              sold,
              source,
              ...(hasRecovery ? [assumptionSource] : []),
            ),
          },
        ]
      : [];
  });
  const breakEvenWeekendMix = completedMix.length
    ? ("base-case-completed" as const)
    : ("arrival-mix-fallback" as const);
  const weekendEconomics = menuEconomics(
    scenario,
    completedMix.length ? completedMix : baseline.shop.menu,
  );
  const result = computeRunway({
    cash: finance.cash,
    startupCosts: [
      finance.fitOut,
      finance.equipmentUpfront,
      ...finance.equipmentAdditions,
    ],
    recurringCosts: [finance.rent, finance.otherRecurring],
    wages,
    price: weekdayEconomics.price,
    ingredientCost: weekdayEconomics.ingredientCost,
    weekendUnitEconomics: weekendEconomics,
    matchedWeekendSales,
    weekdays: {
      daysPerMonth: finance.weekdaysPerMonth,
      demand: finance.weekdayDemand,
      baselineLosses: {
        low: weekdayLoss("low"),
        base: weekdayLoss("base"),
        high: weekdayLoss("high"),
      },
    },
    weekends: {
      daysPerMonth: finance.weekendsPerMonth,
      demand: weekendDemand,
      baselineLosses: weekendLosses,
    },
    savedCustomers: assumption.enabled,
    savedCustomersSource: assumptionSource,
    ...(baseline.demand.pedestrian
      ? { passersByPerOpenDay: baseline.demand.pedestrian.count }
      : {}),
  });
  return {
    ...result,
    assumptions: {
      ...result.assumptions,
      weekdayLegacyDrinks: weekdayEconomics.legacyDrinks,
      weekendLegacyDrinks: weekendEconomics.legacyDrinks,
      breakEvenWeekendMix,
    },
  };
}

export function calculateDecision(
  a: Scenario,
  b: Scenario | null,
  settings: DecisionParameters,
  assumption: SavedCustomerAssumption,
  baseline: Scenario = a,
) {
  const { demand, menuMix } = arrivalInputs(baseline.demand, baseline.shop);
  for (const side of b ? [a, b] : [a]) {
    const items = new Set(side.shop.menu.map(({ id }) => id));
    if (
      menuMix.some(({ itemId, weight }) => weight > 0 && !items.has(itemId))
    ) {
      throw new RangeError(
        `${side.label} must serve the drinks ordered in ${baseline.label}. Restore the missing drinks or select another scenario.`,
      );
    }
  }
  const shopA = serviceInputs(a.shop);
  const shopB = b ? serviceInputs(b.shop) : null;
  const baselineShop =
    baseline.id === a.id || baseline.id === b?.id
      ? null
      : serviceInputs(baseline.shop);
  function runLevel(level: DecisionParameters["demandLevel"]) {
    const taggedDemand = baseline.demand.pedestrian
      ? pedestrianDailyArrivals(baseline.demand.pedestrian)
      : calculateMeasure(
          expectedDailyArrivals(demand, level),
          ...demandSources(baseline.demand, level),
        );
    if (!isServicePlanSizeAllowed(taggedDemand.value, settings.runCount)) {
      throw new RangeError(
        "This test is too large. Reduce demand, the service window, or the number of Saturdays.",
      );
    }
    const plan = createArrivalPlan(
      demand,
      menuMix,
      settings.seed,
      settings.runCount,
      level,
    );
    const aResult = simulateSeries(shopA, plan);
    const bResult = shopB ? simulateSeries(shopB, plan) : null;
    const baselineResult = baselineShop
      ? simulateSeries(baselineShop, plan)
      : baseline.id === b?.id && bResult
        ? bResult
        : aResult;
    const summaryA = summarizeService(a, baseline, plan, aResult);
    const summaryB =
      b && bResult ? summarizeService(b, baseline, plan, bResult) : null;
    const sample: WeekendSample = {
      arrivals: plan.runs.reduce((sum, arrivals) => sum + arrivals.length, 0),
      lostA: aResult.totals.customersLost,
      lostB: bResult?.totals.customersLost ?? null,
      lostBaseline: baselineResult.totals.customersLost,
      arrivalDigest: createHash("sha256")
        .update(JSON.stringify(plan.runs))
        .digest("hex"),
    };
    const lossA = projectedWeekendLoss(
      taggedDemand,
      sample.arrivals,
      sample.lostA,
      serviceSources(baseline.demand, a.shop, level, baseline.shop.menu),
    );
    const lossB =
      b && sample.lostB !== null
        ? projectedWeekendLoss(
            taggedDemand,
            sample.arrivals,
            sample.lostB,
            serviceSources(baseline.demand, b.shop, level, baseline.shop.menu),
          )
        : null;
    const lossBaseline = projectedWeekendLoss(
      taggedDemand,
      sample.arrivals,
      sample.lostBaseline,
      serviceSources(baseline.demand, baseline.shop, level),
    );
    return {
      sample,
      demand: taggedDemand,
      completionsA: matchedCompletions(
        baselineResult,
        aResult,
        sample.arrivals,
        calculateMeasure(0, lossBaseline, lossA),
      ),
      completionsB:
        lossB && bResult
          ? matchedCompletions(
              baselineResult,
              bResult,
              sample.arrivals,
              calculateMeasure(0, lossBaseline, lossB),
            )
          : null,
      lossA,
      lossB,
      lossBaseline,
      serviceA: {
        summary: summaryA,
        playback: aResult.playback as ServiceRun["playback"],
      },
      serviceB:
        summaryB && bResult
          ? {
              summary: summaryB,
              playback: bResult.playback as ServiceRun["playback"],
            }
          : null,
    };
  }
  const levels = {
    low: runLevel("low"),
    base: runLevel("base"),
    high: runLevel("high"),
  };
  const { low, base, high } = levels;
  const weekend = { low: low.sample, base: base.sample, high: high.sample };
  const weekendDemand = {
    low: low.demand,
    base: base.demand,
    high: high.demand,
  };
  const lossesA = { low: low.lossA, base: base.lossA, high: high.lossA };
  const lossesB =
    low.lossB && base.lossB && high.lossB
      ? { low: low.lossB, base: base.lossB, high: high.lossB }
      : undefined;
  const selected = levels[settings.demandLevel];
  const baselineLosses = {
    low: low.lossBaseline,
    base: base.lossBaseline,
    high: high.lossBaseline,
  };
  const cashA = forecast(
    a,
    baseline,
    weekendDemand,
    baselineLosses,
    { low: low.completionsA, base: base.completionsA, high: high.completionsA },
    assumption,
  );
  const cashB = b
    ? forecast(
        b,
        baseline,
        weekendDemand,
        baselineLosses,
        {
          low: low.completionsB!,
          base: base.completionsB!,
          high: high.completionsB!,
        },
        assumption,
      )
    : null;
  return {
    weekend,
    weekendDemand,
    baselineLosses,
    weekendLossA: lossesA,
    weekendLossB: lossesB ?? null,
    serviceA: selected.serviceA,
    serviceB: selected.serviceB,
    cashA,
    cashB,
    delta:
      cashB && selected.serviceB
        ? deltas(
            selected.serviceA.summary,
            selected.serviceB.summary,
            cashA,
            cashB,
          )
        : null,
  };
}

function projectedWeekendLoss(
  demand: CalculatedNumber,
  arrivals: number,
  lost: number,
  sources: Source[],
): CalculatedNumber {
  if (demand.value === 0) return calculateMeasure(0, demand);
  if (arrivals === 0)
    return calculateMeasure(0, demand, { tag: "illustrative" });
  return calculateMeasure(demand.value * (lost / arrivals), demand, ...sources);
}

function deltas(
  a: ServiceRun["summary"],
  b: ServiceRun["summary"],
  cashA: ReturnType<typeof computeRunway>,
  cashB: ReturnType<typeof computeRunway>,
) {
  const diffWait = (field: "waitP50Seconds" | "waitP90Seconds") => {
    const first = a.stats[field];
    const second = b.stats[field];
    return derive(
      first === null || second === null ? null : second - first,
      { tag: a.provenance },
      { tag: b.provenance },
    );
  };
  const diffMoney = (
    first: { value: number; tag: typeof a.provenance },
    second: typeof first,
  ) =>
    derive(Math.round((second.value - first.value) * 100) / 100, first, second);
  const level = a.demandLevel;
  const current = diffMoney(
    cashA.outcomes[level].monthlyCash,
    cashB.outcomes[level].monthlyCash,
  );
  const off = diffMoney(
    cashA.savedCustomersAssumption.monthlyCash[level].off,
    cashB.savedCustomersAssumption.monthlyCash[level].off,
  );
  const on = diffMoney(
    cashA.savedCustomersAssumption.monthlyCash[level].on,
    cashB.savedCustomersAssumption.monthlyCash[level].on,
  );
  const higher = ({ value }: { value: number }) =>
    value > 0 ? ("b" as const) : value < 0 ? ("a" as const) : ("tie" as const);
  return {
    waitP50Seconds: diffWait("waitP50Seconds"),
    waitP90Seconds: diffWait("waitP90Seconds"),
    customersLostPerSaturday: derive(
      b.stats.meanCustomersLost - a.stats.meanCustomersLost,
      { tag: a.provenance },
      { tag: b.provenance },
    ),
    staffPerMonth: diffMoney(cashA.costs.staff, cashB.costs.staff),
    monthlyCash: current,
    closingCashAfterStartup: diffMoney(
      cashA.outcomes[level].closingCash[0]!,
      cashB.outcomes[level].closingCash[0]!,
    ),
    monthlyCashSavedCustomersOff: off,
    monthlyCashSavedCustomersOn: on,
    higherMonthlyCash: {
      current: higher(current),
      off: higher(off),
      on: higher(on),
    },
  };
}

export type DecisionCalculation = ReturnType<typeof calculateDecision>;
