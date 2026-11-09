import { defineActionErrors } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import { scenarios } from "../../db/schema.js";
import { defaultFinance, financeSchema } from "./finance.js";
import {
  defaultDemand,
  defaultShop,
  demandSchema,
  hourlyRateSchema,
  shopSchema,
} from "./scenario.js";

export const scenarioErrors = defineActionErrors(
  "sign_in_required",
  "scenario_not_found",
  "scenario_conflict",
  "invalid_scenario",
);
export const scenarioKey = z.object({
  id: z.string().uuid().describe("Scenario ID returned by list-scenarios"),
});
export const scenarioEditKey = scenarioKey.extend({
  expectedRevision: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Current scenario revision returned by list-scenarios. Read again after a conflict.",
    ),
});
export const scenarioLabel = z.string().trim().min(1).max(50);
export const scenarioFinanceEditKey = scenarioKey.extend({
  expectedFinanceRevision: z.number().int().nonnegative(),
});
export const scenarioVersionKey = scenarioEditKey.extend(
  scenarioFinanceEditKey.shape,
);
export const scenarioSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  financeRevision: z.number().int().nonnegative(),
  label: scenarioLabel,
  parentId: z.string().uuid().nullable(),
  finance: financeSchema,
  baseHourlyDemand: hourlyRateSchema,
  demand: demandSchema,
  shop: shopSchema,
  latestRunId: z.string().uuid().nullable(),
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const scenarioFields = {
  id: scenarios.id,
  revision: scenarios.revision,
  financeRevision: scenarios.financeRevision,
  label: scenarios.label,
  parentId: scenarios.parentId,
  finance: scenarios.finance,
  baseHourlyDemand: scenarios.baseHourlyDemand,
  demand: scenarios.demand,
  shop: scenarios.shop,
  latestRunId: scenarios.latestRunId,
};

type ScenarioRow = Omit<Scenario, "demand" | "shop" | "finance"> &
  Pick<typeof scenarios.$inferSelect, "demand" | "shop" | "finance">;

export function toScenario(row: ScenarioRow): Scenario {
  const demand = row.demand ?? defaultDemand(row.baseHourlyDemand);
  return {
    ...row,
    baseHourlyDemand: demand.hourly.base.value,
    demand,
    shop: row.shop ?? defaultShop(),
    finance: { ...defaultFinance(), ...row.finance },
  };
}

export function requireOwner(email?: string | null): string {
  return (
    email ??
    scenarioErrors.fail(
      "Sign in to access your café scenarios.",
      "sign_in_required",
      { statusCode: 401 },
    )
  );
}

export function scenarioScope(id: string, owner: string) {
  return and(eq(scenarios.id, id), eq(scenarios.ownerEmail, owner));
}

export function currentScenarioScope(
  id: string,
  owner: string,
  revision: number,
) {
  return and(scenarioScope(id, owner), eq(scenarios.revision, revision));
}

export function scenarioConflict(): never {
  return scenarioErrors.fail(
    "Scenario not found or changed. Read the latest scenario and try again.",
    "scenario_conflict",
    { statusCode: 409 },
  );
}

export async function readScenario(
  id: string,
  owner: string,
): Promise<Scenario> {
  const [row] = await getDb()
    .select(scenarioFields)
    .from(scenarios)
    .where(scenarioScope(id, owner));
  if (!row)
    return scenarioErrors.fail("Scenario not found.", "scenario_not_found", {
      statusCode: 404,
    });
  return toScenario(row);
}

export async function saveScenarioInputs(
  id: string,
  owner: string,
  revision: number,
  patch: Partial<Pick<ScenarioRow, "baseHourlyDemand" | "demand" | "shop">>,
): Promise<Scenario> {
  const [row] = await getDb()
    .update(scenarios)
    .set({ ...patch, revision: sql`${scenarios.revision} + 1` })
    .where(currentScenarioScope(id, owner, revision))
    .returning(scenarioFields);
  return row ? toScenario(row) : scenarioConflict();
}

export function validateInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const checked = schema.safeParse(value);
  return checked.success
    ? checked.data
    : scenarioErrors.fail(
        checked.error.issues.map(({ message }) => message).join(" "),
        "invalid_scenario",
        { statusCode: 400 },
      );
}
