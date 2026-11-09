import { defineAction } from "@agent-native/core/action";

import { storedDecisionSchema } from "../server/lib/cafe/decision-receipt.js";
import { saveDecision } from "../server/lib/cafe/decision-store.js";
import { savedCustomerAssumptionSchema } from "../server/lib/cafe/finance.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";
import { serviceParameters } from "../server/lib/cafe/service-run.js";

export default defineAction({
  description:
    "Compare two private café scenarios on the same seeded Saturday arrivals. Related variants use their nearest shared original scenario for arrivals and the reference loss stream. For unrelated scenarios, A supplies both. Both alternatives use the same saved-customer assumption. Returns matched run IDs, loss and wait deltas, staff costs, cash ordering and sensitivity, with independent weekday assumptions.",
  schema: serviceParameters.extend({
    a: scenarioVersionKey,
    b: scenarioVersionKey,
    savedCustomers: savedCustomerAssumptionSchema
      .optional()
      .describe(
        "Whether weekend customers who otherwise leave would place an order after faster service. Omit to retain the last choice for this pair.",
      ),
  }),
  outputSchema: storedDecisionSchema,
  errors: scenarioErrors,
  run: ({ a, b, savedCustomers, ...settings }, ctx) =>
    saveDecision(requireOwner(ctx?.userEmail), {
      a,
      b,
      settings,
      ...(savedCustomers ? { savedCustomers } : {}),
    }),
});
