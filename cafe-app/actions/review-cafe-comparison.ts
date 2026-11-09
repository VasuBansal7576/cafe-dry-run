import { defineAction } from "@agent-native/core/action";
import { getRequestRunContext } from "@agent-native/core/server";

import {
  requireOwner,
  scenarioErrors,
} from "../server/lib/cafe/scenario-store.js";
import {
  currentReviewScope,
  readReviewEvidence,
  reviewInputSchema,
  reviewOutcomes,
  reviewResultSchema,
} from "../server/lib/cafe/structured-review.js";

export default defineAction({
  description:
    "Inspect the selected fresh matched café comparison. Then recommend one returned choice based on the founder's priorities and finish the turn. The app renders the selected recommendation and receipt figures.",
  schema: reviewInputSchema,
  outputSchema: reviewResultSchema,
  errors: scenarioErrors,
  http: false,
  readOnly: true,
  dedupe: false,
  run: async (input, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const scope = currentReviewScope();
    const evidence = scope && (await readReviewEvidence(owner, scope));
    if (!evidence) return { status: "unavailable" as const };
    if (input.operation === "inspect" && input.choice === undefined)
      return evidence;
    if (input.operation !== "recommend" || input.choice === undefined)
      return { status: "choice-unavailable" as const };
    const history = getRequestRunContext()?.toolResults ?? [];
    if (
      !reviewOutcomes(history).some(
        (result) =>
          result.status === "evidence" &&
          result.receiptId === evidence.receiptId,
      )
    )
      return { status: "inspect-first" as const };
    if (!evidence.choices.includes(input.choice))
      return { status: "choice-unavailable" as const };
    return {
      status: "selected" as const,
      receiptId: evidence.receiptId,
      choice: input.choice,
    };
  },
});
