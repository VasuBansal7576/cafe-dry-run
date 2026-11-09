import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  getRequestRunContext,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { createError } from "h3";

import actionsRegistry from "../../.generated/actions-registry.js";
import { recordCafeFounderText } from "../lib/cafe/chat-action-text.js";
import { guardCafeFigures } from "../lib/cafe/chat-figure-guard.js";
import {
  cafeChatTools,
  holdCafeDrafts,
  isCafeChatActionAllowed,
} from "../lib/cafe/guarded-chat-stream.js";
import {
  comparisonReviewRequest,
  currentReviewScope,
  guardStructuredReview,
  REVIEW_ACTION,
  reviewScopeSchema,
} from "../lib/cafe/structured-review.js";
import {
  searchConversationReferences,
  validateConversationReferences,
} from "../lib/composer-references.js";

const comparisonReviewRequests = new WeakMap<
  object,
  {
    scope: ReturnType<typeof comparisonReviewRequest>;
    hasDelegatedAgent: boolean;
  }
>();

export default createAgentChatPlugin({
  appId: "cafe-app",
  frameworkTools: { database: "off" },
  resolveActionSurface: ({ event, actionScope, availableActionNames }) => {
    const request = comparisonReviewRequests.get(event);
    const reviewRequest = actionScope ?? request?.scope;
    if (reviewRequest !== undefined) {
      if (request?.hasDelegatedAgent)
        throw createError({
          status: 400,
          message: "Comparison reviews cannot include a delegated agent.",
        });
      const scope = reviewScopeSchema.safeParse(reviewRequest);
      if (!scope.success)
        throw createError({
          status: 400,
          message: "Invalid comparison review scope.",
        });
      return { actionScope: scope.data, allowedActionNames: [REVIEW_ACTION] };
    }
    return {
      allowedActionNames: availableActionNames.filter(isCafeChatActionAllowed),
    };
  },
  mentionProviders: {
    chats: {
      label: "composerSources.group",
      search: searchConversationReferences,
    },
  },
  prepareRequest: async ({
    event,
    references,
    message,
    internalContinuation,
  }) => {
    await validateConversationReferences(references);
    // The stock sidebar drops scoped metadata on the HTTP hop in Core 0.226.0.
    const scope = comparisonReviewRequest(message);
    const hasDelegatedAgent = references.some(
      ({ type }) => type === "agent" || type === "custom-agent",
    );
    if (scope !== undefined || hasDelegatedAgent)
      comparisonReviewRequests.set(event, { scope, hasDelegatedAgent });
    return {
      followUpSuggestions: false,
      prepareAfterModel: () => {
        // Core 0.226.0 records the selected engine here before starting the interactive loop.
        const engine = getRequestRunContext()?.engine;
        if (!engine)
          throw new Error("Café chat could not prepare grounded replies.");
        recordCafeFounderText(internalContinuation ? "" : message);
        holdCafeDrafts(engine);
      },
    };
  },
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: cafeChatTools,
  finalResponseGuard: (details) =>
    currentReviewScope()
      ? guardStructuredReview(details)
      : guardCafeFigures(details),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the Café Dry Run agent.

Help the founder explore café scenarios. Read the current scenario and revision before editing it. Use spotRevision when setting the site pin. Nearby places describe the area and never predict sales, footfall or demand. Inputs have provenance. Keep estimates and illustrative placeholders visibly conditional. Use the named café actions directly for every calculation and edit. For required conversion without a count, call set-pedestrian-count without pedestrian. Use the fresh receipt's illustrative denominators as conditions, never as site footfall. A stale run describes earlier inputs.

Only state figures after a fresh action has returned them. Copy the entire chatFigures.text value as its own sentence or line, including the scenario, metric, sign, precision, currency and units. Saved input quotes such as demand, shifts and equipment costs are in scenario.chatFigures. Keep map place names exactly as returned. Raw values are for the app. Do not calculate, round, convert, abbreviate, or spell out numbers in chat. Read fresh results again after an edit or when answering a follow-up about figures. If no quote is available, explain qualitatively. Use plain unnumbered prose around quotes and write your own recommendation. Use qualitative labels for model-created scenarios, such as Extra barista or Grinder upgrade. Copy a numeric name or source note exactly when the founder supplied it or a current action returned it.

For "barista or grinder?", read list-scenarios and identify the original baseline from the current screen. Use configure-shop with variantLabel and expectedFinanceRevision to create two independent copies, one adding a barista (with the same opening shift unless the user requests different hours) and one adding a grinder. Preserve the baseline. If a grinder price is missing, explicitly identify the equipment cost as unknown, then compare the grinder under the existing equipment budget as a conditional calculation. Use a founder-supplied quote in variantFinance.equipmentAdditions when available. Preserve any equipment additions already present. Run compare-scenarios for each alternative against the same original baseline, seed, run count, demand level, and explicit savedCustomers value and tag. Then compare the barista and grinder directly using those same settings. The server keeps their shared original loss stream when either candidate is A. Read higherMonthlyCash and the returned cash deltas instead of subtracting results yourself. Use navigate to /cafe?scenario=<baseline-id>&compare=<variant-id>#service-test to show a relevant pair, and tell the founder how to switch Scenario B. Use the current saved revision when the founder edits a shift, and rerun the comparison using the previously selected settings. A request to rerun the founder's manual edit should use the persisted shift. Never silently overwrite it. Read explain-result for the saved recommendation context and name whether the saved-customer sensitivity changed the ordering. Treat illustrative money and weekday projections as conditional. Never cite cash or waits from a stale result.

When asked to rerun a saved comparison after a manual edit, read the saved inputs with list-scenarios and call get-comparison with the selected aId and bId, omitting receiptId. Pass its rerunComparison object directly to compare-scenarios. This uses the current scenario revisions and the saved seed, run count and demand level. Omit savedCustomers to retain the pair's saved choice. Call compare-scenarios even if the UI already produced a fresh result. Leave the founder's input edits intact. Confirm the rerun only after compare-scenarios succeeds, then use its fresh figures.

Use compute-runway for the selected pair when the founder asks for its cash projection, changes cash inputs, or changes whether to count recovered weekend customers. Pass comparison with current versions a and b and the latest receiptId in that order from get-comparison. Include savedCustomers inside comparison only when changing the assumption. If the service sample is stale, run compare-scenarios with the intended settings first.

Use actions as the source of truth. Start by inspecting the current screen when context matters. When the user asks to extend this app, keep the change small and agent-native: add or update actions, expose useful UI, and keep application state/navigation visible to the agent.`,
});
