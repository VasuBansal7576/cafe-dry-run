import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { withDecisionChatFigures } from "../server/lib/cafe/chat-figures.js";
import { saveDecision } from "../server/lib/cafe/decision-store.js";
import {
  decisionWriteOutputSchema,
  decisionWriteResult,
  requireDecisionWriteBudget,
} from "../server/lib/cafe/decision-tool-result.js";
import { savedCustomerAssumptionSchema } from "../server/lib/cafe/finance.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";
import { serviceParameters } from "../server/lib/cafe/service-run.js";

export default defineAction({
  description:
    "Compare two private café scenarios on the same seeded Saturday arrivals. Related variants use their nearest shared original scenario for arrivals and the reference loss stream. For unrelated scenarios, A supplies both. The saved-customer assumption persists for the pair in either order. Call get-comparison to find the current shared arrival source before editing demand. A receiptScope of summary or reference means the receipt was saved and the detailed snapshot was omitted. Quote chatFigures.text verbatim for wait, losses, staff costs, cash and sensitivity.",
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
  outputSchema: decisionWriteOutputSchema,
  maxResultChars: 100_000,
  errors: scenarioErrors,
  run: async (
    { a, b, expectedReceiptId, savedCustomers, ...settings },
    ctx,
  ) => {
    const owner = requireOwner(ctx?.userEmail);
    requireDecisionWriteBudget(ctx?.maxResultChars);
    const saved = await saveDecision(owner, {
      a,
      b,
      settings,
      ...(expectedReceiptId !== undefined ? { expectedReceiptId } : {}),
      ...(savedCustomers ? { savedCustomers } : {}),
    });
    return decisionWriteResult(
      withDecisionChatFigures(saved),
      ctx?.maxResultChars,
    );
  },
});
