import { createHash } from "node:crypto";

import { createArrivalPlan, type ArrivalPlan, type Demand } from "./arrivals";
import { computeRunway, type CashWage, type Levels } from "./cash";
import type { SavedCustomerAssumption } from "./finance";
import {
  calculateMeasure,
  derive,
  type CalculatedNumber,
  type Source,
} from "./provenance";
import {
  arrivalInputs,
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
  arrivalDigest: string;
};

function forecast(
  scenario: Scenario,
  weekendDemand: Levels<CalculatedNumber>,
  weekendLosses: Levels<CalculatedNumber>,
  candidateLosses: Levels<CalculatedNumber> | undefined,
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
  return computeRunway({
    cash: finance.cash,
    startupCosts: [
      finance.fitOut,
      finance.equipmentUpfront,
      ...finance.equipmentAdditions,
    ],
    recurringCosts: [finance.rent, finance.otherRecurring],
    wages,
    price: finance.averagePrice,
    ingredientCost: finance.averageIngredientCost,
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
      ...(candidateLosses ? { scenarioLosses: candidateLosses } : {}),
    },
    savedCustomers: assumption.enabled,
    savedCustomersSource: { tag: assumption.tag },
  });
}

export function calculateDecision(
  a: Scenario,
  b: Scenario | null,
  settings: DecisionParameters,
  assumption: SavedCustomerAssumption,
) {
  const { demand, menuMix } = arrivalInputs(a.demand, a.shop);
  const bItems = new Set(b?.shop.menu.map(({ id }) => id));
  if (
    b &&
    menuMix.some(({ itemId, weight }) => weight > 0 && !bItems.has(itemId))
  ) {
    throw new RangeError(
      "Both shops must serve the drinks ordered in A. Restore the missing drinks in B or select another scenario.",
    );
  }
  const shopA = serviceInputs(a.shop);
  const shopB = b ? serviceInputs(b.shop) : null;
  function runLevel(level: DecisionParameters["demandLevel"]) {
    const expected = expectedDailyArrivals(demand, level);
    if (!isServicePlanSizeAllowed(expected, settings.runCount)) {
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
    const summaryA = summarizeService(a, a, plan, aResult);
    const summaryB =
      b && bResult ? summarizeService(b, a, plan, bResult) : null;
    const sample: WeekendSample = {
      arrivals: plan.runs.reduce((sum, arrivals) => sum + arrivals.length, 0),
      lostA: aResult.totals.customersLost,
      lostB: bResult?.totals.customersLost ?? null,
      arrivalDigest: createHash("sha256")
        .update(JSON.stringify(plan.runs))
        .digest("hex"),
    };
    const taggedDemand = calculateMeasure(
      expected,
      a.demand.hourly[level],
      a.demand.opensAt,
      a.demand.closesAt,
      ...a.demand.hourlyMultipliers,
    );
    const lossA = projectedWeekendLoss(
      taggedDemand,
      sample.arrivals,
      sample.lostA,
      serviceSources(a.demand, a.shop, level),
    );
    const lossB =
      b && sample.lostB !== null
        ? projectedWeekendLoss(
            taggedDemand,
            sample.arrivals,
            sample.lostB,
            serviceSources(a.demand, b.shop, level, a.shop.menu),
          )
        : null;
    return {
      sample,
      demand: taggedDemand,
      lossA,
      lossB,
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
  const cashA = forecast(a, weekendDemand, lossesA, undefined, assumption);
  const cashB = b
    ? forecast(b, weekendDemand, lossesA, lossesB, assumption)
    : null;
  return {
    weekend,
    weekendDemand,
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
  return {
    waitP50Seconds: diffWait("waitP50Seconds"),
    waitP90Seconds: diffWait("waitP90Seconds"),
    customersLostPerSaturday: derive(
      b.stats.meanCustomersLost - a.stats.meanCustomersLost,
      { tag: a.provenance },
      { tag: b.provenance },
    ),
    staffPerMonth: diffMoney(cashA.costs.staff, cashB.costs.staff),
    monthlyCash: diffMoney(
      cashA.outcomes[level].monthlyCash,
      cashB.outcomes[level].monthlyCash,
    ),
    closingCashAfterStartup: diffMoney(
      cashA.outcomes[level].closingCash[0]!,
      cashB.outcomes[level].closingCash[0]!,
    ),
    monthlyCashSavedCustomersOff: diffMoney(
      cashA.outcomes[level].monthlyCash,
      cashB.savedCustomersAssumption.monthlyCash[level].off,
    ),
    monthlyCashSavedCustomersOn: diffMoney(
      cashA.outcomes[level].monthlyCash,
      cashB.savedCustomersAssumption.monthlyCash[level].on,
    ),
  };
}

export type DecisionCalculation = ReturnType<typeof calculateDecision>;
