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
  validateInput,
} from "../server/lib/cafe/scenario-store.js";

const soloRunway = scenarioVersionKey.extend({
  runId: z.string().uuid().describe("Latest fresh standalone Saturday run ID"),
});

export default defineAction({
  description:
    "Compute and save cash runway using the latest fresh service results. For one shop pass id, expectedRevision, expectedFinanceRevision and runId. For a matched pair pass only comparison with both current scenario versions and the latest receiptId for that order from get-comparison. Run compare-scenarios first if the pair has no current service results. Cash edits and saved-customer changes reuse the matched run IDs and settings. A receiptScope of summary or reference means the receipt was saved and the detailed snapshot was omitted. Quote chatFigures.text verbatim in chat.",
  schema: soloRunway.partial().extend({
    comparison: z
      .object({
        a: scenarioVersionKey,
        b: scenarioVersionKey,
        receiptId: z
          .string()
          .uuid()
          .describe("Latest receipt for A and B in this order"),
        savedCustomers: savedCustomerAssumptionSchema
          .optional()
          .describe(
            "Omit to keep the pair's current saved-customer assumption",
          ),
      })
      .optional(),
  }),
  outputSchema: decisionWriteOutputSchema,
  maxResultChars: 100_000,
  errors: scenarioErrors,
  run: async ({ comparison, ...solo }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    requireDecisionWriteBudget(ctx?.maxResultChars);
    if (comparison) {
      if (Object.values(solo).some((value) => value !== undefined))
        return scenarioErrors.fail(
          "Pass a matched comparison or a standalone run.",
          "invalid_scenario",
        );
      const { savedCustomers, ...request } = comparison;
      const saved = await saveDecision(owner, {
        ...request,
        ...(savedCustomers ? { savedCustomers } : {}),
      });
      return decisionWriteResult(
        withDecisionChatFigures(saved),
        ctx?.maxResultChars,
      );
    }
    const { runId, ...a } = validateInput(soloRunway, solo);
    const saved = await saveDecision(owner, { a, runId });
    return decisionWriteResult(
      withDecisionChatFigures(saved),
      ctx?.maxResultChars,
    );
  },
});
