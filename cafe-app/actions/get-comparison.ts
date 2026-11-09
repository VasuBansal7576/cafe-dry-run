import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { storedDecisionSchema } from "../server/lib/cafe/decision-receipt.js";
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
    "Read a saved comparison or standalone runway, its shared cash baseline, linked Saturday runs, exact sample totals, cash and reversing assumption. Historical receipts retain their own assumptions. Check historical, serviceStale, cashStale and currentSavedCustomers before presenting one as current.",
  schema: decisionScopeSchema,
  outputSchema: z.object({ decision: storedDecisionSchema.nullable() }),
  errors: scenarioErrors,
  readOnly: true,
  http: { method: "GET" },
  run: async (args, ctx) => ({
    decision: await readDecision(requireOwner(ctx?.userEmail), args),
  }),
});
