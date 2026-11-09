import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import { financeFields, financeSchema } from "../server/lib/cafe/finance.js";
import {
  currentScenarioScope,
  readScenario,
  requireOwner,
  saveScenarioInputs,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioFields,
  scenarioLabel,
  scenarioSchema,
  toScenario,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";
import { shopFields, shopSchema } from "../server/lib/cafe/scenario.js";

export default defineAction({
  description:
    "Edit a cafe scenario's staff shifts, equipment, menu mix, service times or customer patience. To create a variant without altering the original, send variantLabel and the changes. Read list-scenarios for the current revision and financeRevision. Include existing workers when adding one.",
  schema: scenarioEditKey.extend({
    shop: shopFields
      .partial()
      .default({})
      .describe("Tagged shop fields to replace. Omitted fields are preserved."),
    variantLabel: scenarioLabel
      .optional()
      .describe(
        "Copy the scenario under this label and apply the patch to the copy only.",
      ),
    expectedFinanceRevision: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Required when copying a variant."),
    variantFinance: financeFields
      .partial()
      .optional()
      .describe(
        "Optional tagged money changes when copying, such as equipmentAdditions containing an extra grinder quote.",
      ),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async (
    {
      id,
      expectedRevision,
      shop: patch,
      variantLabel,
      expectedFinanceRevision,
      variantFinance,
    },
    ctx,
  ) => {
    const owner = requireOwner(ctx?.userEmail);
    if (variantLabel) {
      if (expectedFinanceRevision === undefined) {
        return scenarioErrors.fail(
          "Supply the baseline financeRevision to copy a variant.",
          "invalid_scenario",
        );
      }
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .select(scenarioFields)
          .from(scenarios)
          .where(currentScenarioScope(id, owner, expectedRevision))
          .for("update");
        if (!row || row.financeRevision !== expectedFinanceRevision)
          return scenarioConflict();
        const baseline = toScenario(row);
        const [existing] = await tx
          .select({ id: scenarios.id })
          .from(scenarios)
          .where(
            and(
              eq(scenarios.ownerEmail, owner),
              eq(scenarios.parentId, id),
              eq(scenarios.label, variantLabel),
            ),
          )
          .limit(1);
        if (existing)
          return scenarioErrors.fail(
            "This baseline already has a variant with that label. Select it or choose a new label.",
            "invalid_scenario",
          );
        const [variant] = await tx
          .insert(scenarios)
          .values({
            id: crypto.randomUUID(),
            ownerEmail: owner,
            label: variantLabel,
            parentId: id,
            baseHourlyDemand: baseline.baseHourlyDemand,
            demand: baseline.demand,
            shop: validateInput(shopSchema, { ...baseline.shop, ...patch }),
            finance: validateInput(financeSchema, {
              ...baseline.finance,
              ...variantFinance,
            }),
          })
          .returning(scenarioFields);
        return { scenario: toScenario(variant!) };
      });
    }
    if (variantFinance || !Object.keys(patch).length) {
      return scenarioErrors.fail(
        "Supply a shop field to change, or give a label to create a variant.",
        "invalid_scenario",
      );
    }
    const current = await readScenario(id, owner);
    if (current.revision !== expectedRevision) return scenarioConflict();
    const shop = validateInput(shopSchema, { ...current.shop, ...patch });
    return {
      scenario: await saveScenarioInputs(id, owner, expectedRevision, { shop }),
    };
  },
});
