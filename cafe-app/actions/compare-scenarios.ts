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
    "Compare two private cafe scenarios on the same actual seeded Saturday arrivals and save the result with both run IDs, wait, losses, monthly staff cost, monthly cash and saved-customer sensitivity. A supplies demand and drink choices. Weekday assumptions remain independent.",
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
