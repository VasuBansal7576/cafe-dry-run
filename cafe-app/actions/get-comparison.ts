import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type { ObservedDecision } from "../server/lib/cafe/chat-figure-basis.js";
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
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";
import { serviceParameters } from "../server/lib/cafe/service-run.js";

const rerunComparisonSchema = serviceParameters.required().extend({
  a: scenarioVersionKey,
  b: scenarioVersionKey,
});

function currentVersion(decision: ObservedDecision, id: string) {
  const scenario = decision.quoteObservations.scenarios.find(
    (version) => version.id === id,
  );
  if (scenario?.revision === undefined || scenario.financeRevision === undefined)
    return undefined;
  return {
    id,
    expectedRevision: scenario.revision,
    expectedFinanceRevision: scenario.financeRevision,
  };
}

export default defineAction({
  description:
    "Read a comparison's current arrivalSource even before running it. To rerun the latest saved pair with current inputs and the same settings, pass rerunComparison directly to compare-scenarios. To edit shared demand, use the arrival source ID and revision with set-demand or set-pedestrian-count. The receipt reports freshness and decision.chatFigures.text to quote verbatim when fresh.",
  schema: decisionScopeSchema,
  outputSchema: z.object({
    rerunComparison: rerunComparisonSchema.optional(),
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
    let rerunComparison: z.infer<typeof rerunComparisonSchema> | undefined;
    if (decision && args.bId && args.receiptId === undefined) {
      const a = currentVersion(decision, args.aId);
      const b = currentVersion(decision, args.bId);
      if (a && b) rerunComparison = { a, b, ...decision.receipt.settings };
    }
    return {
      ...(rerunComparison ? { rerunComparison } : {}),
      decision: decision ? withDecisionChatFigures(decision) : null,
      arrivalSource,
    };
  },
});
