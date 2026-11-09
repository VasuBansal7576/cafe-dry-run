import {
  DEFAULT_TOOL_RESULT_CHARS,
  defineAction,
} from "@agent-native/core/action";
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
import { decisionSummarySchema } from "../server/lib/cafe/decision-tool-result.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioSchema,
  scenarioVersionKey,
} from "../server/lib/cafe/scenario-store.js";
import { serviceParameters } from "../server/lib/cafe/service-run.js";
import { fitsToolResult } from "../server/lib/cafe/tool-result-budget.js";

const rerunComparisonSchema = serviceParameters.required().extend({
  a: scenarioVersionKey,
  b: scenarioVersionKey,
});
const arrivalSourceSchema = scenarioSchema.pick({
  id: true,
  revision: true,
  label: true,
  demand: true,
});
const summaryArrivalSource = arrivalSourceSchema.omit({ demand: true });
const comparisonSummarySchema = z.object({
  decision: decisionSummarySchema.nullable(),
  arrivalSource: summaryArrivalSource.nullable(),
});

function currentVersion(decision: ObservedDecision, id: string) {
  const scenario = decision.quoteObservations.scenarios.find(
    (version) => version.id === id,
  );
  if (
    scenario?.revision === undefined ||
    scenario.financeRevision === undefined
  )
    return undefined;
  return {
    id,
    expectedRevision: scenario.revision,
    expectedFinanceRevision: scenario.financeRevision,
  };
}

export default defineAction({
  description:
    "Read a comparison's current arrivalSource even before running it. To rerun the latest saved pair with current inputs and the same settings, pass rerunComparison directly to compare-scenarios. To edit shared demand, use the arrival source ID and revision with set-demand or set-pedestrian-count. When comparisonSummary is present, use its decision and arrivalSource. It keeps receipt identity, settings, freshness, deltas and exact chatFigures, and omits detailed input snapshots and monthly balances available in the café. Quote chatFigures.text verbatim when fresh.",
  schema: decisionScopeSchema,
  outputSchema: z.object({
    rerunComparison: rerunComparisonSchema.optional(),
    decision: decisionChatOutputSchema.nullable(),
    arrivalSource: arrivalSourceSchema.nullable(),
    comparisonSummary: comparisonSummarySchema.optional(),
  }),
  errors: scenarioErrors,
  readOnly: true,
  http: { method: "GET" },
  maxResultChars: 100_000,
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
    const result = {
      ...(rerunComparison ? { rerunComparison } : {}),
      decision: decision ? withDecisionChatFigures(decision) : null,
      arrivalSource,
    };
    const budget = ctx?.maxResultChars;
    if (
      budget === undefined ||
      fitsToolResult(result, Math.min(budget, DEFAULT_TOOL_RESULT_CHARS))
    )
      return result;

    const summary = {
      ...(rerunComparison ? { rerunComparison } : {}),
      decision: null,
      arrivalSource: null,
      comparisonSummary: comparisonSummarySchema.parse(result),
    };
    if (fitsToolResult(summary, budget)) return summary;
    return scenarioErrors.fail(
      "The comparison summary exceeds this agent's tool result limit. Read the decision in the café.",
      "invalid_scenario",
    );
  },
});
