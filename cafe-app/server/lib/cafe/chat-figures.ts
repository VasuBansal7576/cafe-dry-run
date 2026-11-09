import { z } from "zod";

import {
  chatFigureBasisSchema,
  decisionFigureBasis,
  type ObservedDecision,
} from "./chat-figure-basis.js";
import {
  storedDecisionSchema,
  type DecisionReceipt,
} from "./decision-receipt.js";
import { sourceTagSchema, weakestTag, type SourceTag } from "./provenance.js";
import type { Scenario } from "./scenario-store.js";
import type { ServiceRun } from "./service-run.js";

export const chatFiguresSchema = z
  .record(
    z.string(),
    z.object({ text: z.string(), tag: sourceTagSchema.optional() }),
  )
  .describe(
    "Server-formatted figures for chat. Quote text verbatim, including its units, and keep its provenance conditional when applicable.",
  );
type ChatFigures = z.infer<typeof chatFiguresSchema>;
export const decisionChatOutputSchema = z.object({
  chatFigureBasis: chatFigureBasisSchema,
  chatFigures: chatFiguresSchema.nullable(),
  ...storedDecisionSchema.shape,
});

const decimal = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const count = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inputNumber = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 2,
});
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
type Figure = { value: number | null; tag?: SourceTag };

function display({ value, tag }: Figure, unit: string, format = decimal) {
  const text =
    value === null
      ? "Unavailable"
      : `${format.format(value === 0 ? 0 : value)}${unit}`;
  return { text, ...(tag ? { tag } : {}) };
}

export function scenarioChatFigures({
  label,
  demand,
  finance,
  shop,
}: Pick<Scenario, "label" | "demand" | "finance" | "shop">): ChatFigures {
  const name = JSON.stringify(label);
  const clock = (seconds: number) =>
    `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
  return {
    ...Object.fromEntries(
      Object.entries(demand.hourly).map(([level, value]) => [
        `demand.${level}`,
        {
          text: `${name} ${level} demand is ${inputNumber.format(value.value)} arrivals per hour`,
          tag: value.source.tag,
        },
      ]),
    ),
    ...Object.fromEntries(
      shop.workers.flatMap(({ id, name: worker, shifts }) =>
        shifts.map(({ startsAt, endsAt }, i) => [
          `shifts.${id}.${i}`,
          {
            text: `${name} shift for ${JSON.stringify(worker)} is ${clock(startsAt.value)} to ${clock(endsAt.value)}`,
            tag: weakestTag([startsAt.source, endsAt.source]),
          },
        ]),
      ),
    ),
    ...Object.fromEntries(
      finance.equipmentAdditions.map(({ value, source }, i) => [
        `equipmentQuote.${i}`,
        {
          text: `${name} additional equipment quote is ${money.format(value)}`,
          tag: source.tag,
        },
      ]),
    ),
  };
}

function context(
  figure: { text: string; tag?: SourceTag },
  description: string,
) {
  return { ...figure, text: `${description} ${figure.text}` };
}

export function serviceChatFigures(
  { stats, provenance, runCount, seed, staffNames }: ServiceRun["summary"],
  label: string,
): ChatFigures {
  const name = JSON.stringify(label);
  const service = (value: number | null, unit: string) =>
    display({ value, tag: provenance }, unit);
  return {
    waitP50: context(
      service(stats.waitP50Seconds, " seconds"),
      `${name} median wait is`,
    ),
    waitP90: context(
      service(stats.waitP90Seconds, " seconds"),
      `${name} p90 wait is`,
    ),
    meanOrdersServed: context(
      service(stats.meanOrdersServed, " orders served per Saturday"),
      `${name} averages`,
    ),
    meanCustomersLost: context(
      service(stats.meanCustomersLost, " customers lost per Saturday"),
      `${name} averages`,
    ),
    runCount: context(
      display(
        { value: runCount },
        runCount === 1 ? " Saturday" : " Saturdays",
        count,
      ),
      `${name} simulation covers`,
    ),
    seed: { text: `${name} simulation uses seed ${count.format(seed)}` },
    ...(stats.bottleneck && {
      bottleneckWait: context(
        service(
          stats.bottleneck.totalWaitSeconds,
          ` seconds of blocked time at ${JSON.stringify(stats.bottleneck.label)}`,
        ),
        `${name} recorded`,
      ),
    }),
    ...Object.fromEntries(
      stats.utilization.map(({ id, fraction, fractionProvenance }) => [
        `utilization.${id}`,
        context(
          display(
            { value: fraction, tag: fractionProvenance ?? provenance },
            ` utilization for ${JSON.stringify(staffNames[id] ?? id)}`,
            percent,
          ),
          `${name} recorded`,
        ),
      ]),
    ),
  };
}

export function prefixChatFigures(
  prefix: string,
  figures: ChatFigures,
): ChatFigures {
  return Object.fromEntries(
    Object.entries(figures).map(([key, figure]) => [
      `${prefix}.${key}`,
      figure,
    ]),
  );
}

export function captureChatFigures(
  {
    breakEvenOrdersPerDay,
    illustrativeCaptureRates,
  }: Pick<
    DecisionReceipt["a"]["cash"],
    "breakEvenOrdersPerDay" | "illustrativeCaptureRates"
  >,
  label: string,
): ChatFigures {
  const name = JSON.stringify(label);
  const figures: ChatFigures = {
    breakEvenOrdersPerOpenDay: context(
      display(breakEvenOrdersPerDay, " orders per open day", count),
      `${name} breaks even at`,
    ),
  };
  for (const [
    index,
    { passersByPerOpenDay, rate },
  ] of illustrativeCaptureRates.entries()) {
    const passersBy = display(
      passersByPerOpenDay,
      " illustrative passers-by per open day",
      count,
    );
    figures[`illustrativeCaptureRate.${index}`] = {
      text: `${name} requires ${percent.format(rate.value)} at ${passersBy.text}`,
      tag: rate.tag,
    };
  }
  return figures;
}

export function pedestrianChatFigures(
  label: string,
  count: Figure,
  conversion: Figure,
  arrivals: Figure,
): ChatFigures {
  const name = JSON.stringify(label);
  return {
    observedCount: context(
      display(count, " counted passers-by per Saturday", decimal),
      `${name} recorded`,
    ),
    assumedConversion: context(
      display(
        {
          ...conversion,
          value: conversion.value === null ? null : conversion.value / 100,
        },
        " conversion",
        percent,
      ),
      `${name} assumes`,
    ),
    expectedArrivals: context(
      display(arrivals, " expected arrivals per Saturday"),
      `${name} projects`,
    ),
  };
}

function decisionSideFigures(
  { service, cash, label }: DecisionReceipt["a"],
  level: DecisionReceipt["settings"]["demandLevel"],
): ChatFigures {
  const outcome = cash.outcomes[level];
  const sensitivity = cash.savedCustomersAssumption.monthlyCash[level];
  const name = JSON.stringify(label);
  const projected = (figure: Figure, units: string, format = decimal) =>
    context(display(figure, units, format), `${name} projects`);
  return {
    ...serviceChatFigures(service.summary, label),
    ...captureChatFigures(cash, label),
    weekdayOrders: projected(
      outcome.weekdayOrdersPerDay,
      " orders per weekday",
    ),
    weekendOrders: projected(
      outcome.weekendOrdersPerDay,
      " orders per weekend day",
    ),
    monthlyOrders: projected(outcome.monthlyOrders, " orders per month"),
    recoveredOrders: projected(
      outcome.recoveredOrdersPerMonth,
      " recovered orders per month",
    ),
    revenue: projected(outcome.monthlyRevenue, " revenue per month", money),
    staffCost: projected(cash.costs.staff, " staff cost per month", money),
    startupCost: projected(cash.costs.startup, " in startup costs", money),
    monthlyCash: context(
      display(outcome.monthlyCash, " per month", money),
      `${name} projected cash flow is`,
    ),
    cashAfterStartup: projected(
      outcome.closingCash[0]!,
      " in cash after startup",
      money,
    ),
    runway:
      outcome.runway.value.kind === "no-burn"
        ? { text: `${name} has no recurring burn`, tag: outcome.runway.tag }
        : projected(
            { value: outcome.runway.value.months, tag: outcome.runway.tag },
            " months of runway",
          ),
    monthlyCashSavedCustomersOff: context(
      display(sensitivity.off, " per month", money),
      `${name} projected cash flow without recovered customers is`,
    ),
    monthlyCashSavedCustomersOn: context(
      display(sensitivity.on, " per month", money),
      `${name} projected cash flow counting recovered customers is`,
    ),
    ...(cash.requiredCaptureRate && {
      requiredCaptureRate: context(
        display(cash.requiredCaptureRate, " conversion to break even", percent),
        `${name} requires`,
      ),
    }),
  };
}

export function withDecisionChatFigures(observed: ObservedDecision) {
  const { quoteObservations: _, ...decision } = observed;
  const { receipt, serviceStale, cashStale } = decision;
  const chatFigureBasis = decisionFigureBasis(observed);
  if (serviceStale || cashStale)
    return { chatFigureBasis, chatFigures: null, ...decision };
  const level = receipt.settings.demandLevel;
  const sample = receipt.weekend[level];
  const { a, b, delta } = receipt;
  const nameA = JSON.stringify(a.label);
  const nameB = b && JSON.stringify(b.label);
  const changeBy = (
    figure: Figure,
    metric: string,
    units: string,
    format = decimal,
  ) =>
    context(
      display(figure, units, format),
      `From ${nameA} to ${nameB}, ${metric} changes by`,
    );
  return {
    chatFigureBasis,
    chatFigures: {
      "sample.arrivals": context(
        display({ value: sample.arrivals }, " Saturday arrivals", count),
        nameB
          ? `${nameA} and ${nameB} share a sample of`
          : `${nameA} simulates a sample of`,
      ),
      "sample.lostA": context(
        display(
          { value: sample.lostA },
          " customer losses in the Saturday sample",
          count,
        ),
        `${nameA} recorded`,
      ),
      ...(nameB &&
        sample.lostB !== null && {
          "sample.lostB": context(
            display(
              { value: sample.lostB },
              " customer losses in the Saturday sample",
              count,
            ),
            `${nameB} recorded`,
          ),
        }),
      ...prefixChatFigures("scenarioA", decisionSideFigures(receipt.a, level)),
      ...(receipt.b &&
        prefixChatFigures("scenarioB", decisionSideFigures(receipt.b, level))),
      ...(b &&
        delta &&
        prefixChatFigures("bMinusA", {
          waitP50: changeBy(
            delta.waitP50Seconds,
            "the median wait",
            " seconds",
          ),
          waitP90: changeBy(delta.waitP90Seconds, "the p90 wait", " seconds"),
          customersLost: changeBy(
            delta.customersLostPerSaturday,
            "the number of customers lost",
            " per Saturday",
          ),
          staffCost: changeBy(
            delta.staffPerMonth,
            "staff cost",
            " per month",
            money,
          ),
          monthlyCash: changeBy(
            delta.monthlyCash,
            "projected cash flow",
            " per month",
            money,
          ),
          cashAfterStartup: changeBy(
            delta.closingCashAfterStartup,
            "cash after startup",
            "",
            money,
          ),
          monthlyCashSavedCustomersOff: changeBy(
            delta.monthlyCashSavedCustomersOff,
            "projected cash flow without recovered customers",
            " per month",
            money,
          ),
          monthlyCashSavedCustomersOn: changeBy(
            delta.monthlyCashSavedCustomersOn,
            "projected cash flow counting recovered customers",
            " per month",
            money,
          ),
        })),
    } satisfies ChatFigures,
    ...decision,
  };
}
