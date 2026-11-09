import { z } from "zod";

import { chatFigureBasisSchema } from "./chat-figure-basis.js";
import { decisionChatOutputSchema } from "./chat-figures.js";
import { decisionReceiptSchema } from "./decision-receipt.js";
import { serviceRunSchema } from "./service-run.js";
import { fitsToolResult } from "./tool-result-budget.js";

const summarySide = decisionReceiptSchema.shape.a
  .pick({ label: true, financeRevision: true })
  .extend({
    service: serviceRunSchema.pick({
      id: true,
      scenarioId: true,
      scenarioRevision: true,
      arrivalSource: true,
    }),
  });
const summaryReceipt = decisionReceiptSchema
  .pick({
    id: true,
    settings: true,
    savedCustomers: true,
    cashBaseline: true,
    weekendDemand: true,
    weekend: true,
    delta: true,
  })
  .extend({ a: summarySide, b: summarySide.nullable() });
export const decisionSummarySchema = decisionChatOutputSchema.extend({
  receipt: summaryReceipt,
});

const decisionWriteSummary = decisionSummarySchema.extend({
  receiptScope: z.literal("summary"),
});
const decisionWriteReference = z.object({
  receiptScope: z.literal("reference"),
  chatFigureBasis: chatFigureBasisSchema,
  receipt: z.object({ id: z.uuid() }),
});
export const decisionWriteOutputSchema = z.union([
  decisionWriteSummary,
  decisionWriteReference,
  decisionChatOutputSchema,
]);

export function decisionWriteResult(
  saved: z.output<typeof decisionChatOutputSchema>,
  budget: number | undefined,
) {
  if (budget === undefined || fitsToolResult(saved, budget)) return saved;
  const summary = decisionWriteSummary.parse({
    ...saved,
    receiptScope: "summary",
  });
  if (fitsToolResult(summary, budget)) return summary;
  // The write already succeeded. Return its identity even if the caller's
  // budget cannot fit the quote bundle; do not fail or repeat the write.
  return {
    receiptScope: "reference" as const,
    chatFigureBasis: saved.chatFigureBasis,
    receipt: { id: saved.receipt.id },
  };
}
