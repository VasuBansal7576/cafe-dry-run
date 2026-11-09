import { z } from "zod";

import { financeSchema, savedCustomerAssumptionSchema } from "./finance";
import { sourceTagSchema } from "./provenance";
import { serviceParameters, serviceRunSchema } from "./service-run";

const figure = z.object({ value: z.number(), tag: sourceTagSchema });
const optionalFigure = figure.extend({ value: z.number().nullable() });
const levels = <T extends z.ZodType>(value: T) =>
  z.object({ low: value, base: value, high: value });
const outcome = z.object({
  weekdayOrdersPerDay: figure,
  weekendOrdersPerDay: figure,
  monthlyOrders: figure,
  recoveredOrdersPerMonth: figure,
  monthlyRevenue: figure,
  monthlyIngredientCost: figure,
  monthlyCash: figure,
  burn: figure,
  runway: z.object({
    tag: sourceTagSchema,
    value: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("finite"), months: z.number() }),
      z.object({ kind: z.literal("no-burn"), months: z.null() }),
    ]),
  }),
  closingCash: z.array(figure),
});
const cash = z.object({
  breakEvenOrdersPerDay: optionalFigure,
  requiredCaptureRate: optionalFigure.nullable(),
  illustrativeCaptureRates: z.array(
    z.object({ passersByPerOpenDay: figure, rate: figure }),
  ),
  contributionPerOrder: figure,
  costs: z.object({
    startup: figure,
    recurring: figure,
    staff: figure,
    weekdayStaff: figure,
    weekendStaff: figure,
    recurringIncludingStaff: figure,
  }),
  outcomes: levels(outcome),
  assumptions: z.object({
    weekdayDays: financeSchema.shape.weekdaysPerMonth,
    weekendDays: financeSchema.shape.weekendsPerMonth,
    horizonMonths: z.number(),
  }),
  savedCustomersAssumption: z.object({
    input: z.literal("savedCustomers"),
    label: z.string(),
    enabled: z.boolean(),
    monthlyCash: levels(z.object({ off: figure, on: figure })),
  }),
});

const side = z.object({
  label: z.string(),
  financeRevision: z.number(),
  finance: financeSchema,
  service: serviceRunSchema.omit({ playback: true }),
  weekendLosses: levels(figure),
  cash,
});

export const decisionReceiptSchema = z.object({
  id: z.string().uuid(),
  settings: serviceParameters.required(),
  savedCustomers: savedCustomerAssumptionSchema,
  a: side,
  b: side.nullable(),
  weekendDemand: levels(figure),
  weekend: levels(
    z.object({
      arrivals: z.number(),
      lostA: z.number(),
      lostB: z.number().nullable(),
      arrivalDigest: z.string(),
    }),
  ),
  delta: z
    .object({
      waitP50Seconds: optionalFigure,
      waitP90Seconds: optionalFigure,
      customersLostPerSaturday: figure,
      staffPerMonth: figure,
      monthlyCash: figure,
      closingCashAfterStartup: figure,
      monthlyCashSavedCustomersOff: figure,
      monthlyCashSavedCustomersOn: figure,
    })
    .nullable(),
});

export const storedDecisionSchema = z.object({
  receipt: decisionReceiptSchema,
  serviceStale: z.boolean(),
  cashStale: z.boolean(),
});

export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;
export type StoredDecision = z.infer<typeof storedDecisionSchema>;
