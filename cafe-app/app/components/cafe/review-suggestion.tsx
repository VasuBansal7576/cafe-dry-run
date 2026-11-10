import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useAgentThreadSelector } from "@agent-native/toolkit/app/agentkit/react/context";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import { Link, useLocation } from "react-router";

import { Button } from "@/components/ui/button";

import {
  reviewSuggestionLine,
  reviewSuggestionResultSchema,
  SAVED_CUSTOMERS_REVIEW_WIDGET,
  type ReviewSuggestion,
} from "../../../shared/cafe/structured-review";
import { pairCalculationScope, useCalculationState } from "./calculation-state";

function ReviewSuggestionCard({ context }: ToolRendererProps) {
  const parsed = reviewSuggestionResultSchema.safeParse(context.resultJson);
  const { widgetId } = context;
  const confirmed = useAgentThreadSelector((thread) => {
    if (!widgetId || !parsed.success) return false;
    const messageId = thread.widgetMessageIds[widgetId];
    const reply = thread.messages.find(({ id }) => id === messageId);
    if (reply?.role !== "assistant" || reply.status !== "complete")
      return false;
    const callId = widgetId.replace(/:chat-ui$/, "");
    const runId = thread.tools[callId]?.runId;
    if (runId && thread.runs[runId]?.status !== "completed") return false;
    const text = reply.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    // Only the final response guard can publish this closing line in a scoped review.
    if (
      !text
        .trimEnd()
        .endsWith(`\n\n${reviewSuggestionLine(parsed.data.suggestion.enabled)}`)
    )
      return false;
    // A receipt offers at most one distinct change, even if several tool calls chose it.
    const first = Object.entries(thread.widgetMessageIds).find(
      ([id, attachedTo]) =>
        attachedTo === messageId &&
        thread.widgets[id]?.kind === SAVED_CUSTOMERS_REVIEW_WIDGET,
    );
    return first?.[0] === widgetId;
  });
  const busy = useAgentThreadSelector(
    (thread) => thread.activeRunIds.length > 0,
  );
  // The inline activity row and the saved widget use the same renderer.
  if (context.isActiveTail !== undefined || !parsed.success || !confirmed)
    return null;
  return (
    <SavedCustomersSuggestion suggestion={parsed.data.suggestion} busy={busy} />
  );
}

function SavedCustomersSuggestion({
  suggestion: { a, b, receiptId, enabled, figure },
  busy,
}: {
  suggestion: ReviewSuggestion;
  busy: boolean;
}) {
  const location = useLocation();
  const selection = new URLSearchParams(location.search);
  const onBoard =
    location.pathname === "/cafe" &&
    selection.get("scenario") === a.id &&
    selection.get("compare") === b.id;
  const saved = useActionQuery(
    "get-comparison",
    { aId: a.id, bId: b.id },
    { enabled: onBoard },
  );
  const scope = pairCalculationScope(a.id, b.id);
  const calculation = useCalculationState(scope);
  const apply = useActionMutation("compute-runway", {
    mutationKey: [...scope, "compute-runway"],
    onError: () => void saved.refetch(),
  });
  const decision = saved.data?.decision;
  const fresh = decision && !decision.cashStale && !decision.serviceStale;
  const current = fresh && decision.receipt.id === receiptId;
  const stale =
    onBoard &&
    decision &&
    (!fresh ||
      (decision.receipt.id !== receiptId &&
        decision.receipt.id !== apply.data?.receipt.id));
  const canApply =
    current &&
    !saved.isError &&
    !busy &&
    !calculation.pending &&
    !apply.isSuccess;
  const destination =
    "/cafe?" +
    new URLSearchParams({ scenario: a.id, compare: b.id }) +
    "#service-test";
  return (
    <section className="space-y-3 text-sm" aria-label="Agent suggestion">
      <p className="font-medium">Agent suggestion</p>
      <p>
        Test the monthly cash projection {enabled ? "counting" : "excluding"}{" "}
        recovered weekend customers.
      </p>
      <p className="break-words text-muted-foreground">
        {figure.text}.{" "}
        {figure.tag && <span className="capitalize">({figure.tag})</span>}
        {stale && " · Stale"}
      </p>
      {onBoard ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-11 whitespace-normal py-2 text-start aria-disabled:opacity-70"
            aria-disabled={!canApply}
            onClick={() => {
              if (!canApply || calculation.inFlight()) return;
              apply.mutate({
                comparison: {
                  a,
                  b,
                  receiptId,
                  savedCustomers: { enabled, tag: "estimate" },
                },
              });
            }}
          >
            {apply.isSuccess
              ? "Projection updated"
              : apply.isPending
                ? "Updating projection…"
                : enabled
                  ? "Try counting recovered weekend customers"
                  : "Try excluding recovered weekend customers"}
          </Button>
          {apply.isSuccess ? (
            <p role="status">
              {enabled
                ? "Saved the projection with recovered weekend customers counted."
                : "Saved the projection with recovered weekend customers excluded."}
            </p>
          ) : apply.error ? (
            <p role="alert">
              {actionErrorMessage(apply.error) ??
                "Could not update the projection."}
            </p>
          ) : saved.isError ? (
            <p role="alert">Could not verify this comparison.</p>
          ) : !current && !saved.isPending ? (
            <p role="status">
              This comparison changed. Use Explain again for a current
              suggestion.
            </p>
          ) : null}
        </>
      ) : (
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={destination}
        >
          Open this comparison in Café
        </Link>
      )}
    </section>
  );
}

registerActionChatRenderer({
  id: SAVED_CUSTOMERS_REVIEW_WIDGET,
  renderer: SAVED_CUSTOMERS_REVIEW_WIDGET,
  Component: ReviewSuggestionCard,
});
