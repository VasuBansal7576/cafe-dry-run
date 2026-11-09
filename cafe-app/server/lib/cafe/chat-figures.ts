import { z } from "zod";

import {
  chatFigureBasisSchema,
  decisionFigureBasis,
} from "./chat-figure-basis.js";
import {
  storedDecisionSchema,
  type DecisionReceipt,
  type StoredDecision,
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
  { stats, provenance, runCount, seed }: ServiceRun["summary"],
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
    runCount: display(
      { value: runCount },
      runCount === 1 ? " Saturday" : " Saturdays",
      count,
    ),
    seed: { text: `seed ${count.format(seed)}` },
    ...(stats.bottleneck && {
      bottleneckWait: service(
        stats.bottleneck.totalWaitSeconds,
        " seconds of blocked time",
      ),
    }),
    ...Object.fromEntries(
      stats.utilization.map(({ id, fraction }) => [
        `utilization.${id}`,
        display({ value: fraction, tag: provenance }, " utilization", percent),
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
  return {
    ...serviceChatFigures(service.summary, label),
    ...captureChatFigures(cash, label),
    weekdayOrders: display(outcome.weekdayOrdersPerDay, " orders per weekday"),
    weekendOrders: display(
      outcome.weekendOrdersPerDay,
      " orders per weekend day",
    ),
    monthlyOrders: display(outcome.monthlyOrders, " orders per month"),
    recoveredOrders: display(
      outcome.recoveredOrdersPerMonth,
      " recovered orders per month",
    ),
    revenue: display(outcome.monthlyRevenue, " revenue per month", money),
    staffCost: display(cash.costs.staff, " staff cost per month", money),
    startupCost: display(cash.costs.startup, " startup cost", money),
    monthlyCash: context(
      display(outcome.monthlyCash, " per month", money),
      `${name} projected cash flow is`,
    ),
    cashAfterStartup: display(
      outcome.closingCash[0]!,
      " cash after startup",
      money,
    ),
    runway:
      outcome.runway.value.kind === "no-burn"
        ? { text: "No recurring burn", tag: outcome.runway.tag }
        : display(
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
      requiredCaptureRate: display(
        cash.requiredCaptureRate,
        " required conversion",
        percent,
      ),
    }),
  };
}

export function withDecisionChatFigures(decision: StoredDecision) {
  const { receipt, serviceStale, cashStale } = decision;
  const chatFigureBasis = decisionFigureBasis(receipt);
  if (serviceStale || cashStale)
    return { chatFigureBasis, chatFigures: null, ...decision };
  const level = receipt.settings.demandLevel;
  const sample = receipt.weekend[level];
  const { delta } = receipt;
  const change = `From ${JSON.stringify(receipt.a.label)} to ${JSON.stringify(receipt.b?.label)},`;
  return {
    chatFigureBasis,
    chatFigures: {
      "sample.arrivals": display(
        { value: sample.arrivals },
        " matched arrivals",
        count,
      ),
      "sample.lostA": display(
        { value: sample.lostA },
        " losses in the matched sample",
        count,
      ),
      ...(sample.lostB !== null && {
        "sample.lostB": display(
          { value: sample.lostB },
          " losses in the matched sample",
          count,
        ),
      }),
      ...prefixChatFigures("scenarioA", decisionSideFigures(receipt.a, level)),
      ...(receipt.b &&
        prefixChatFigures("scenarioB", decisionSideFigures(receipt.b, level))),
      ...(delta &&
        prefixChatFigures("bMinusA", {
          waitP50: context(
            display(delta.waitP50Seconds, " seconds"),
            `${change} the median wait changes by`,
          ),
          waitP90: context(
            display(delta.waitP90Seconds, " seconds"),
            `${change} the p90 wait changes by`,
          ),
          customersLost: display(
            delta.customersLostPerSaturday,
            " customers lost per Saturday",
          ),
          staffCost: display(
            delta.staffPerMonth,
            " staff cost per month",
            money,
          ),
          monthlyCash: context(
            display(delta.monthlyCash, " per month", money),
            `${change} projected cash flow changes by`,
          ),
          cashAfterStartup: display(
            delta.closingCashAfterStartup,
            " cash after startup",
            money,
          ),
          monthlyCashSavedCustomersOff: display(
            delta.monthlyCashSavedCustomersOff,
            " per month",
            money,
          ),
          monthlyCashSavedCustomersOn: display(
            delta.monthlyCashSavedCustomersOn,
            " per month",
            money,
          ),
        })),
    } satisfies ChatFigures,
    ...decision,
  };
}
