import { defineAction } from "@agent-native/core/action";

import { decisionFigureBasis } from "../server/lib/cafe/chat-figure-basis.js";
import { withDecisionChatFigures } from "../server/lib/cafe/chat-figures.js";
import {
  decisionScopeSchema,
  readDecision,
} from "../server/lib/cafe/decision-store.js";
import {
  requireOwner,
  scenarioErrors,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Read a fresh café decision's reversing assumption, tested cases, trade-offs and provenance. Quote chatFigures.text verbatim for figures. The chat model writes the recommendation.",
  schema: decisionScopeSchema,
  errors: scenarioErrors,
  http: false,
  readOnly: true,
  run: async (args, ctx) => {
    const decision = await readDecision(requireOwner(ctx?.userEmail), args);
    if (!decision)
      return { status: "Run a comparison or calculate runway first." };
    if (decision.cashStale)
      return {
        chatFigureBasis: decisionFigureBasis(decision),
        chatFigures: null,
        status: decision.assumptionStale
          ? "This historical receipt used a superseded saved-customer assumption. Read the latest comparison for the current decision."
          : "Stale receipt. Read current scenario revisions and run a fresh comparison before giving a recommendation.",
        historical: decision.historical,
        currentSavedCustomers: decision.currentSavedCustomers,
      };
    const { receipt } = decision;
    const level = receipt.settings.demandLevel;
    const { chatFigureBasis, chatFigures } = withDecisionChatFigures(decision);
    return {
      chatFigureBasis,
      chatFigures,
      receiptId: receipt.id,
      historical: decision.historical,
      currentSavedCustomers: decision.currentSavedCustomers,
      demandCase: level,
      matchedWeekendSample: receipt.weekend[level],
      sharedCashBaseline: receipt.cashBaseline,
      scenarioA: {
        label: receipt.a.label,
        serviceRun: receipt.a.service.id,
        bottleneck: receipt.a.service.summary.stats.bottleneck,
        breakEvenOrdersPerOpenDay: receipt.a.cash.breakEvenOrdersPerDay,
        breakEvenWeekendMix: receipt.a.cash.assumptions.breakEvenWeekendMix,
        monthlyCash: receipt.a.cash.outcomes[level].monthlyCash,
        runway: receipt.a.cash.outcomes[level].runway,
      },
      scenarioB: receipt.b && {
        label: receipt.b.label,
        serviceRun: receipt.b.service.id,
        bottleneck: receipt.b.service.summary.stats.bottleneck,
        breakEvenOrdersPerOpenDay: receipt.b.cash.breakEvenOrdersPerDay,
        breakEvenWeekendMix: receipt.b.cash.assumptions.breakEvenWeekendMix,
        monthlyCash: receipt.b.cash.outcomes[level].monthlyCash,
        runway: receipt.b.cash.outcomes[level].runway,
      },
      scenarioBMinusScenarioA: receipt.delta,
      reversingAssumption: receipt.b && {
        label:
          "Count weekend customers who would have left but now place an order",
        enabled: receipt.savedCustomers.enabled,
        provenance: receipt.savedCustomers.tag,
        test: "Use higherMonthlyCash to explain the current ordering and the ordering under each switch setting.",
      },
      basis:
        "Both scenarios use the exact same Saturday arrivals. Weekend sales use completed orders by drink, scaled to expected daily arrivals. With the switch off, sales use the lower of the shop and baseline completion counts for each drink on each Saturday. Turning it on adds the shop's additional completed drinks only when total sample losses fall. Break-even holds daily orders constant and uses the projected base-case weekend mix, or the arrival mix if there are no projected orders. Weekdays use their own assumptions. Cash figures are INR per month except for cash after startup. Wait figures are seconds and losses are orders per Saturday.",
    };
  },
});
