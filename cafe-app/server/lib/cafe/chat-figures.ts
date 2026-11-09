import { z } from "zod";

import {
  storedDecisionSchema,
  type DecisionReceipt,
  type StoredDecision,
} from "./decision-receipt.js";
import { sourceTagSchema, type SourceTag } from "./provenance.js";
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
  chatFigures: chatFiguresSchema.nullable(),
  ...storedDecisionSchema.shape,
});

const decimal = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const count = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
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

export function serviceChatFigures({
  stats,
  provenance,
  runCount,
  seed,
}: ServiceRun["summary"]): ChatFigures {
  const service = (value: number | null, unit: string) =>
    display({ value, tag: provenance }, unit);
  return {
    waitP50: service(stats.waitP50Seconds, " seconds"),
    waitP90: service(stats.waitP90Seconds, " seconds"),
    meanOrdersServed: service(
      stats.meanOrdersServed,
      " orders served per Saturday",
    ),
    meanCustomersLost: service(
      stats.meanCustomersLost,
      " customers lost per Saturday",
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

export function captureChatFigures({
  breakEvenOrdersPerDay,
  illustrativeCaptureRates,
}: Pick<
  DecisionReceipt["a"]["cash"],
  "breakEvenOrdersPerDay" | "illustrativeCaptureRates"
>): ChatFigures {
  const figures: ChatFigures = {
    breakEvenOrdersPerOpenDay: display(
      breakEvenOrdersPerDay,
      " orders per open day",
      count,
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
      text: `${percent.format(rate.value)} at ${passersBy.text}`,
      tag: rate.tag,
    };
  }
  return figures;
}

export function pedestrianChatFigures(
  count: Figure,
  conversion: Figure,
  arrivals: Figure,
): ChatFigures {
  return {
    observedCount: display(count, " counted passers-by per Saturday", decimal),
    assumedConversion: display(
      {
        ...conversion,
        value: conversion.value === null ? null : conversion.value / 100,
      },
      " conversion",
      percent,
    ),
    expectedArrivals: display(arrivals, " expected arrivals per Saturday"),
  };
}

function decisionSideFigures(
  { service, cash }: DecisionReceipt["a"],
  level: DecisionReceipt["settings"]["demandLevel"],
): ChatFigures {
  const outcome = cash.outcomes[level];
  const sensitivity = cash.savedCustomersAssumption.monthlyCash[level];
  return {
    ...serviceChatFigures(service.summary),
    ...captureChatFigures(cash),
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
    monthlyCash: display(outcome.monthlyCash, " per month", money),
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
    monthlyCashSavedCustomersOff: display(sensitivity.off, " per month", money),
    monthlyCashSavedCustomersOn: display(sensitivity.on, " per month", money),
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
  if (serviceStale || cashStale) return { chatFigures: null, ...decision };
  const level = receipt.settings.demandLevel;
  const sample = receipt.weekend[level];
  const { delta } = receipt;
  return {
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
          waitP50: display(delta.waitP50Seconds, " seconds"),
          waitP90: display(delta.waitP90Seconds, " seconds"),
          customersLost: display(
            delta.customersLostPerSaturday,
            " customers lost per Saturday",
          ),
          staffCost: display(
            delta.staffPerMonth,
            " staff cost per month",
            money,
          ),
          monthlyCash: display(delta.monthlyCash, " per month", money),
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
