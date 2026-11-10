import {
  getRequestRunContext,
  getRequestUserEmail,
  type AgentLoopFinalResponseGuard,
} from "@agent-native/core/server";
import { splitAgentChatContextFromMessage } from "@agent-native/core/shared";
import { z } from "zod";

import {
  COMPARISON_REVIEW_CONTEXT,
  COMPARISON_REVIEW_PROMPT,
  reviewSuggestionSchema,
  type ReviewSuggestion,
} from "../../../shared/cafe/structured-review.js";
import { chatFiguresSchema, withDecisionChatFigures } from "./chat-figures.js";
import type { DecisionReceipt } from "./decision-receipt.js";
import { readDecision } from "./decision-store.js";

export const REVIEW_ACTION = "review-cafe-comparison";
export const reviewScopeSchema = z.strictObject({
  kind: z.literal("cafe-comparison-review"),
  aId: z.uuid(),
  bId: z.uuid(),
  receiptId: z.uuid(),
});
type ReviewScope = z.infer<typeof reviewScopeSchema>;

const choices = {
  "a-for-shorter-wait": { scenario: "a", priority: "shorter waits matter" },
  "b-for-shorter-wait": { scenario: "b", priority: "shorter waits matter" },
  "a-for-cash": { scenario: "a", priority: "projected monthly cash matters" },
  "b-for-cash": { scenario: "b", priority: "projected monthly cash matters" },
  "defer-for-evidence": null,
} as const;
const conventionalLabels = new Set([
  "baseline",
  "baseline shop",
  "saturday baseline",
  "one barista",
  "two baristas",
  "extra barista",
  "extra grinder",
  "grinder upgrade",
]);
const choiceSchema = z.enum(
  Object.keys(choices) as [keyof typeof choices, ...(keyof typeof choices)[]],
);
type ReviewChoice = z.infer<typeof choiceSchema>;
const receiptStatus = z.enum([
  "unavailable",
  "inspect-first",
  "choice-unavailable",
]);
const reversalSchema = z.enum(["reverses", "ties-change", "unchanged"]);
const figureKeys = [
  "scenarioA.waitP50",
  "scenarioB.waitP50",
  "bMinusA.customersLost",
  "bMinusA.staffCost",
  "scenarioA.monthlyCash",
  "scenarioB.monthlyCash",
  "bMinusA.monthlyCashSavedCustomersOff",
  "bMinusA.monthlyCashSavedCustomersOn",
] as const;
const reversalText = {
  reverses:
    "Counting recovered weekend customers reverses which scenario has higher projected monthly cash.",
  "ties-change":
    "Counting recovered weekend customers changes the projected cash tie.",
  unchanged:
    "Counting recovered weekend customers leaves the projected monthly cash ordering unchanged in this sample.",
} as const;

export const reviewInputSchema = z.strictObject({
  operation: z.enum(["inspect", "recommend"]),
  choice: choiceSchema.optional(),
  suggestion: z
    .literal("test-recovered-customers")
    .optional()
    .describe(
      "Include only on recommend, when inspect returned alternateAssumption and you recommend testing that setting for this comparison.",
    ),
});
export const reviewResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("evidence"),
    receiptId: z.uuid(),
    choices: z.array(choiceSchema),
    labels: z.object({ a: z.string(), b: z.string() }),
    figures: chatFiguresSchema,
    reversal: reversalSchema,
    alternateAssumption: reviewSuggestionSchema.optional(),
  }),
  z.object({
    status: z.literal("selected"),
    receiptId: z.uuid(),
    choice: choiceSchema,
    suggestion: reviewSuggestionSchema.optional(),
  }),
  ...receiptStatus.options.map((status) =>
    z.object({ status: z.literal(status) }),
  ),
]);

type ReviewEvidence = Extract<
  z.infer<typeof reviewResultSchema>,
  { status: "evidence" }
>;
const unavailableText =
  "I couldn't complete a recommendation for that comparison. Open a fresh matched comparison and ask again.";
const retryText = `Use ${REVIEW_ACTION} with operation inspect, then recommend with one returned choice. Finish the turn after the action accepts your choice.`;

export function comparisonReviewRequest(
  message: string,
): ReviewScope | null | undefined {
  const parts = splitAgentChatContextFromMessage(message);
  if (parts.message.trim() !== COMPARISON_REVIEW_PROMPT) return;
  const marker = parts.context
    .split("\n")
    .find((line) => line.startsWith(COMPARISON_REVIEW_CONTEXT));
  if (!marker) return null;
  try {
    const parsed = reviewScopeSchema.safeParse(
      JSON.parse(marker.slice(COMPARISON_REVIEW_CONTEXT.length)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function currentReviewScope() {
  const parsed = reviewScopeSchema.safeParse(
    getRequestRunContext()?.actionScope,
  );
  return parsed.success ? parsed.data : null;
}

function reviewLabel(alias: string, label: string) {
  return conventionalLabels.has(label.toLowerCase())
    ? `${alias} (${label})`
    : alias;
}

function receiptVersion({ financeRevision, service }: DecisionReceipt["a"]) {
  return {
    id: service.scenarioId,
    expectedRevision: service.scenarioRevision,
    expectedFinanceRevision: financeRevision,
  };
}

export async function readReviewEvidence(
  owner: string,
  scope: ReviewScope,
): Promise<ReviewEvidence | null> {
  const observed = await readDecision(owner, scope);
  if (
    !observed ||
    observed.historical ||
    observed.serviceStale ||
    observed.cashStale
  )
    return null;
  const { receipt } = observed;
  const { a, b, delta } = receipt;
  const ordering = delta?.higherMonthlyCash;
  if (!b || !delta || !ordering) return null;
  const labels = {
    a: reviewLabel("Scenario A", a.label),
    b: reviewLabel("Scenario B", b.label),
  };
  const { chatFigures } = withDecisionChatFigures({
    ...observed,
    receipt: {
      ...receipt,
      a: { ...a, label: labels.a },
      b: { ...b, label: labels.b },
    },
  });
  const checked = chatFiguresSchema.safeParse(chatFigures);
  if (!checked.success || figureKeys.some((key) => !checked.data[key]))
    return null;
  const supported: ReviewChoice[] = [];
  const wait = delta.waitP50Seconds.value;
  if (wait !== null && wait !== 0)
    supported.push(wait > 0 ? "a-for-shorter-wait" : "b-for-shorter-wait");
  if (ordering.current !== "tie")
    supported.push(ordering.current === "a" ? "a-for-cash" : "b-for-cash");
  supported.push("defer-for-evidence");
  const reversal =
    ordering.off === ordering.on
      ? "unchanged"
      : ordering.off === "tie" || ordering.on === "tie"
        ? "ties-change"
        : "reverses";
  const figures = Object.fromEntries(
    figureKeys.map((key) => [key, checked.data[key]!]),
  );
  const enabled = !receipt.savedCustomers.enabled;
  const alternateFigure =
    figures[
      enabled
        ? "bMinusA.monthlyCashSavedCustomersOn"
        : "bMinusA.monthlyCashSavedCustomersOff"
    ]!;
  const alternateAssumption =
    delta.monthlyCashSavedCustomersOff.value ===
    delta.monthlyCashSavedCustomersOn.value
      ? undefined
      : {
          a: receiptVersion(a),
          b: receiptVersion(b),
          receiptId: receipt.id,
          enabled,
          figure: alternateFigure,
        };
  return {
    status: "evidence",
    receiptId: receipt.id,
    choices: supported,
    labels,
    figures,
    reversal,
    ...(alternateAssumption ? { alternateAssumption } : {}),
  };
}

export function reviewOutcomes(
  results: readonly { name: string; content: string; isError: boolean }[],
) {
  return results.flatMap(({ name, content, isError }) => {
    if (name !== REVIEW_ACTION || isError) return [];
    try {
      const parsed = reviewResultSchema.safeParse(JSON.parse(content));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

function selectedReview(
  receiptId: string,
  results: Parameters<typeof reviewOutcomes>[0],
) {
  const selection = reviewOutcomes(results)
    .filter(
      (result) =>
        result.status === "selected" && result.receiptId === receiptId,
    )
    .pop();
  return selection?.status === "selected" ? selection : undefined;
}

export function reviewTerminalSentinel(receiptId: string) {
  // Core 0.226.0 checks for empty content before invoking the final guard.
  if (selectedReview(receiptId, getRequestRunContext()?.toolResults ?? []))
    return "Comparison review ready.";
}

function renderReview(
  evidence: ReviewEvidence,
  choice: ReviewChoice,
  suggestion: ReviewSuggestion | undefined,
) {
  const reason = choices[choice];
  const recommendation = reason
    ? `I favor ${evidence.labels[reason.scenario]} if ${reason.priority} most.`
    : "I would defer the decision until we can verify the inputs that matter most to you.";
  const figures = figureKeys.map((key) => {
    const { text, tag } = evidence.figures[key]!;
    return `- ${text}${tag ? ` (${tag})` : ""}`;
  });
  // The stock transcript follows the end of a new reply.
  return [
    figures.join("\n"),
    "## Recommendation",
    recommendation,
    reversalText[evidence.reversal],
    ...(suggestion
      ? [
          suggestion.enabled
            ? "I would also test the projection counting recovered weekend customers."
            : "I would also test the projection excluding recovered weekend customers.",
        ]
      : []),
  ].join("\n\n");
}

export const guardStructuredReview: AgentLoopFinalResponseGuard = async (
  details,
) => {
  const scope = currentReviewScope();
  if (!scope) return;
  const owner = getRequestUserEmail();
  const current = owner && (await readReviewEvidence(owner, scope));
  if (!current)
    return {
      retryMessage: unavailableText,
      fallbackMessage: unavailableText,
      clearAllText: true,
      maxRetries: 0,
    };
  const selection = selectedReview(current.receiptId, details.toolResults);
  if (!selection || !current.choices.includes(selection.choice))
    return {
      retryMessage: retryText,
      fallbackMessage: unavailableText,
      clearAllText: true,
      maxRetries: 1,
    };
  const fallbackMessage = renderReview(
    current,
    selection.choice,
    selection.suggestion,
  );
  return {
    retryMessage: retryText,
    fallbackMessage,
    clearAllText: true,
    maxRetries: 0,
  };
};
