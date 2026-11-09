import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  decisionChatOutputSchema,
  withDecisionChatFigures,
} from "../server/lib/cafe/chat-figures.js";
import { saveDecision } from "../server/lib/cafe/decision-store.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Compute and save standalone cash runway for a fresh Saturday run using independent weekday assumptions and tagged prices, staff, startup and recurring costs. Quote chatFigures.text verbatim in chat. For paired runway use compare-scenarios.",
  schema: scenarioVersionKey.extend({
    runId: z.string().uuid().describe("Latest fresh Saturday run ID"),
  }),
  outputSchema: decisionChatOutputSchema,
  errors: scenarioErrors,
  run: async ({ runId, ...a }, ctx) =>
    withDecisionChatFigures(
      await saveDecision(requireOwner(ctx?.userEmail), { a, runId }),
    ),
});
