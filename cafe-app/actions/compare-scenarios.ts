import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  decisionChatOutputSchema,
  withDecisionChatFigures,
} from "../server/lib/cafe/chat-figures.js";
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
    "Compare two private café scenarios on the same seeded Saturday arrivals. Related variants use their nearest shared original scenario for arrivals and the reference loss stream. For unrelated scenarios, A supplies both. The saved-customer assumption persists for the pair in either order. Call get-comparison to find the current shared arrival source before editing demand. Quote chatFigures.text verbatim for wait, losses, staff costs, cash and sensitivity.",
  schema: serviceParameters.extend({
    a: scenarioVersionKey,
    b: scenarioVersionKey,
    expectedReceiptId: z
      .uuid()
      .optional()
      .describe(
        "Require this to still be the latest receipt for A and B in this order when starting a new comparison with previously read settings.",
      ),
    savedCustomers: savedCustomerAssumptionSchema
      .optional()
      .describe(
        "Whether weekend customers who otherwise leave would place an order after faster service. Omit to retain the last choice for this pair in either order.",
      ),
  }),
  outputSchema: decisionChatOutputSchema,
  errors: scenarioErrors,
  run: async ({ a, b, expectedReceiptId, savedCustomers, ...settings }, ctx) =>
    withDecisionChatFigures(
      await saveDecision(requireOwner(ctx?.userEmail), {
        a,
        b,
        settings,
        ...(expectedReceiptId !== undefined ? { expectedReceiptId } : {}),
        ...(savedCustomers ? { savedCustomers } : {}),
      }),
    ),
});
