import { defineAction } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import { financeFields, financeSchema } from "../server/lib/cafe/finance.js";
import {
  readScenario,
  requireOwner,
  scenarioConflict,
  scenarioErrors,
  scenarioFields,
  scenarioSchema,
  scenarioFinanceEditKey,
  scenarioScope,
  toScenario,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Edit a scenario's tagged cash, rent, wages, one-time and recurring costs, average order economics or independent weekday demand and staffing. Money edits do not invalidate Saturday playback.",
  schema: scenarioFinanceEditKey.extend({
    finance: financeFields
      .partial()
      .describe(
        "Fields to replace. Supply all three levels when replacing weekdayDemand.",
      ),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async ({ id, expectedFinanceRevision, finance: patch }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    if (!Object.keys(patch).length) {
      return scenarioErrors.fail(
        "Supply at least one money field to change.",
        "invalid_scenario",
      );
    }
    const current = await readScenario(id, owner);
    if (current.financeRevision !== expectedFinanceRevision)
      return scenarioConflict();
    const finance = validateInput(financeSchema, {
      ...current.finance,
      ...patch,
    });
    const [row] = await getDb()
      .update(scenarios)
      .set({ finance, financeRevision: sql`${scenarios.financeRevision} + 1` })
      .where(
        and(
          scenarioScope(id, owner),
          eq(scenarios.financeRevision, expectedFinanceRevision),
        ),
      )
      .returning(scenarioFields);
    if (!row) return scenarioConflict();
    return { scenario: toScenario(row) };
  },
});
