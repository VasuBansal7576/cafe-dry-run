import { z } from "zod";

import { sourceTagSchema } from "../../server/lib/cafe/provenance.js";

export const COMPARISON_REVIEW_PROMPT =
  "Explain this café comparison. Inspect the matched result, then choose the recommendation you favor based on my priorities.";

export const COMPARISON_REVIEW_CONTEXT = "cafe-comparison-review:";

export const SAVED_CUSTOMERS_REVIEW_WIDGET = "cafe.saved-customers-review";

const scenarioVersion = z.object({
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  expectedFinanceRevision: z.number().int().nonnegative(),
});

export const reviewSuggestionSchema = z.object({
  a: scenarioVersion,
  b: scenarioVersion,
  receiptId: z.uuid(),
  enabled: z.boolean(),
  figure: z.object({ text: z.string(), tag: sourceTagSchema.optional() }),
});

export const reviewSuggestionResultSchema = z.object({
  suggestion: reviewSuggestionSchema,
});

export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;

export function reviewSuggestionLine(enabled: boolean) {
  return enabled
    ? "I would also test the projection counting recovered weekend customers."
    : "I would also test the projection excluding recovered weekend customers.";
}
