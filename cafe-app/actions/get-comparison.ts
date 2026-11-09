import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  decisionChatOutputSchema,
  withDecisionChatFigures,
} from "../server/lib/cafe/chat-figures.js";
import {
  decisionScopeSchema,
  readArrivalSource,
  readDecision,
} from "../server/lib/cafe/decision-store.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioSchema,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Read a comparison's current arrivalSource even before running it. To edit shared demand, use its ID and revision with set-demand or set-pedestrian-count. Also returns the saved receipt, freshness and decision.chatFigures.text to quote verbatim when fresh.",
  schema: decisionScopeSchema,
  outputSchema: z.object({
    decision: decisionChatOutputSchema.nullable(),
    arrivalSource: scenarioSchema
      .pick({ id: true, revision: true, label: true, demand: true })
      .nullable(),
  }),
  errors: scenarioErrors,
  readOnly: true,
  http: { method: "GET" },
  run: async (args, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const [arrivalSource, decision] = await Promise.all([
      args.bId ? readArrivalSource(owner, args.aId, args.bId) : null,
      readDecision(owner, args),
    ]);
    return {
      decision: decision ? withDecisionChatFigures(decision) : null,
      arrivalSource,
    };
  },
});
