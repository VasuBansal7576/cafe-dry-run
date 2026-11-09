import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  readScenario,
  requireOwner,
  saveScenarioInputs,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioSchema,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";
import { shopFields, shopSchema } from "../server/lib/cafe/scenario.js";

export default defineAction({
  description:
    "Edit a cafe scenario's staff shifts, equipment, menu mix, service times or customer patience. Read list-scenarios for the current inputs and revision. To add a barista, include all existing workers in the replacement list.",
  schema: scenarioEditKey.extend({
    shop: shopFields
      .partial()
      .describe("Tagged shop fields to replace. Omitted fields are preserved."),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, shop: patch }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    if (!Object.keys(patch).length)
      return scenarioErrors.fail(
        "Supply at least one shop field to change.",
        "invalid_scenario",
      );
    const current = await readScenario(id, owner);
    if (current.revision !== expectedRevision) return scenarioConflict();
    const shop = validateInput(shopSchema, { ...current.shop, ...patch });
    return {
      scenario: await saveScenarioInputs(id, owner, expectedRevision, { shop }),
    };
  },
});
