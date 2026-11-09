import { defineAction } from "@agent-native/core/action";

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
    "Read the grounded facts for a chat explanation of a saved café comparison. Returns the reversing assumption and its tested cases, exact matched sample counts, trade-offs and provenance. The chat model writes the recommendation.",
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
        status:
          "Stale receipt. Read current scenario revisions and run a fresh comparison before giving a recommendation.",
      };
    const { receipt } = decision;
    const level = receipt.settings.demandLevel;
    return {
      receiptId: receipt.id,
      demandCase: level,
      matchedWeekendSample: receipt.weekend[level],
      baseline: {
        label: receipt.a.label,
        serviceRun: receipt.a.service.id,
        bottleneck: receipt.a.service.summary.stats.bottleneck,
        breakEvenOrdersPerOpenDay: receipt.a.cash.breakEvenOrdersPerDay,
        monthlyCash: receipt.a.cash.outcomes[level].monthlyCash,
        runway: receipt.a.cash.outcomes[level].runway,
      },
      alternative: receipt.b && {
        label: receipt.b.label,
        serviceRun: receipt.b.service.id,
        bottleneck: receipt.b.service.summary.stats.bottleneck,
        breakEvenOrdersPerOpenDay: receipt.b.cash.breakEvenOrdersPerDay,
        monthlyCash: receipt.b.cash.outcomes[level].monthlyCash,
        runway: receipt.b.cash.outcomes[level].runway,
      },
      alternativeMinusBaseline: receipt.delta,
      reversingAssumption: receipt.b && {
        label:
          "Count weekend customers who would have left but now place an order",
        enabled: receipt.savedCustomers.enabled,
        provenance: receipt.savedCustomers.tag,
        test: "The monthly cash delta is provided with the switch off and with it on. Say whether the tested values actually cross zero.",
      },
      basis:
        "Both scenarios use the exact same Saturday arrivals from A. Weekdays use their own assumptions. Weekend daily losses use the matched sample loss share. Cash figures are INR per month except for cash after startup. Wait figures are seconds and losses are orders per Saturday.",
    };
  },
});
