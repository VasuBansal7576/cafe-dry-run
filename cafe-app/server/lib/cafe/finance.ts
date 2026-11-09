import { z } from "zod";

import { illustrative, sourced, sourceTagSchema } from "./provenance";

const money = sourced(z.number().min(0).max(1_000_000_000));
const demand = sourced(z.number().min(0).max(120_000));
export const financeFields = z.object({
  cash: money.describe("Available opening cash in INR before startup costs"),
  rent: money.describe("Rent per month in INR"),
  otherRecurring: money.describe(
    "Recurring costs per month, excluding wages and rent, in INR",
  ),
  fitOut: money.describe("Fit-out and other one-time startup costs in INR"),
  equipmentUpfront: money.describe("Base one-time equipment spend in INR"),
  equipmentAdditions: z
    .array(money)
    .max(20)
    .describe(
      "Additional one-time equipment quotes in INR. Preserve existing quotes when adding a purchase.",
    ),
  averagePrice: money.describe("Blended sales price per order in INR"),
  averageIngredientCost: money.describe(
    "Blended ingredient cost per order in INR",
  ),
  hourlyWage: money.describe("Hourly pay per worker in INR"),
  weekdayStaffCount: sourced(z.number().int().min(0).max(20)),
  weekdayHoursPerWorker: sourced(z.number().min(0).max(24)),
  weekdaysPerMonth: sourced(z.number().int().min(0).max(23)),
  weekendsPerMonth: sourced(z.number().int().min(0).max(10)),
  weekdayDemand: z.object({ low: demand, base: demand, high: demand }),
  weekdayLossPercent: sourced(z.number().min(0).max(100)).describe(
    "Independent assumed weekday loss percentage. Saturday results do not change this value.",
  ),
});

export const financeSchema = financeFields.superRefine((input, ctx) => {
  const { low, base, high } = input.weekdayDemand;
  if (low.value > base.value || base.value > high.value) {
    ctx.addIssue({
      code: "custom",
      path: ["weekdayDemand"],
      message: "Weekday demand must satisfy low ≤ base ≤ high.",
    });
  }
  if (input.weekdaysPerMonth.value + input.weekendsPerMonth.value > 31) {
    ctx.addIssue({
      code: "custom",
      path: ["weekendsPerMonth"],
      message: "Total open days cannot exceed 31 per month.",
    });
  }
});

export type ScenarioFinance = z.infer<typeof financeSchema>;

export function defaultFinance(): ScenarioFinance {
  return {
    cash: illustrative(400_000),
    rent: illustrative(45_000),
    otherRecurring: illustrative(22_000),
    fitOut: illustrative(175_000),
    equipmentUpfront: illustrative(75_000),
    equipmentAdditions: [],
    averagePrice: illustrative(160),
    averageIngredientCost: illustrative(55),
    hourlyWage: illustrative(150),
    weekdayStaffCount: illustrative(1),
    weekdayHoursPerWorker: illustrative(6),
    weekdaysPerMonth: illustrative(22),
    weekendsPerMonth: illustrative(8),
    weekdayDemand: {
      low: illustrative(45),
      base: illustrative(70),
      high: illustrative(100),
    },
    weekdayLossPercent: illustrative(0),
  };
}

export const savedCustomerAssumptionSchema = z.object({
  enabled: z.boolean(),
  tag: sourceTagSchema.exclude(["public"]),
});

export type SavedCustomerAssumption = z.infer<
  typeof savedCustomerAssumptionSchema
>;

export const defaultSavedCustomers: SavedCustomerAssumption = {
  enabled: false,
  tag: "illustrative",
};
