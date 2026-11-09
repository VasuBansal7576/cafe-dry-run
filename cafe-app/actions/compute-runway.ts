import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { storedDecisionSchema } from "../server/lib/cafe/decision-receipt.js";
import { saveDecision } from "../server/lib/cafe/decision-store.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Compute and save standalone cash runway for a fresh Saturday run using independent weekday assumptions and tagged prices, staff, startup and recurring costs. For paired runway use compare-scenarios, then get-comparison to read the matched projections.",
  schema: scenarioVersionKey.extend({
    runId: z.string().uuid().describe("Latest fresh Saturday run ID"),
  }),
  outputSchema: storedDecisionSchema,
  errors: scenarioErrors,
  run: ({ runId, ...a }, ctx) =>
    saveDecision(requireOwner(ctx?.userEmail), { a, runId }),
});
