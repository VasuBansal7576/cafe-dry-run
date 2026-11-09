import { z } from "zod";

import type { DecisionReceipt } from "./decision-receipt.js";
import type { ServiceRun } from "./service-run.js";

const id = z.uuid();
const revision = z.number().int().nonnegative();
export const chatFigureBasisSchema = z.object({
  scenarios: z.array(
    z.object({
      id,
      revision: revision.optional(),
      financeRevision: revision.optional(),
    }),
  ),
  runIds: z.array(id).optional(),
  latestRun: z.object({ scenarioId: id, id }).optional(),
  receiptId: id.optional(),
  assumption: z.object({ pair: z.string(), revision }).optional(),
});
export type ChatFigureBasis = z.infer<typeof chatFigureBasisSchema>;

type ServiceReference = Pick<
  ServiceRun,
  "id" | "scenarioId" | "scenarioRevision" | "arrivalSource"
>;

export function serviceFigureBasis(run: ServiceReference): ChatFigureBasis {
  return {
    scenarios: [
      { id: run.scenarioId, revision: run.scenarioRevision },
      ...(run.arrivalSource ? [run.arrivalSource] : []),
    ],
    runIds: [run.id],
  };
}

export function decisionFigureBasis(receipt: DecisionReceipt): ChatFigureBasis {
  const { a, b, cashBaseline } = receipt;
  return {
    scenarios: [
      ...serviceFigureBasis(a.service).scenarios,
      { id: a.service.scenarioId, financeRevision: a.financeRevision },
      ...(b
        ? [
            ...serviceFigureBasis(b.service).scenarios,
            { id: b.service.scenarioId, financeRevision: b.financeRevision },
          ]
        : []),
      ...(cashBaseline
        ? [{ id: cashBaseline.id, revision: cashBaseline.revision }]
        : []),
    ],
    runIds: b ? [a.service.id, b.service.id] : [a.service.id],
    receiptId: receipt.id,
    ...(b
      ? {
          assumption: {
            pair: [a.service.scenarioId, b.service.scenarioId].sort().join(":"),
            revision: receipt.assumptionRevision ?? 0,
          },
        }
      : {
          latestRun: { scenarioId: a.service.scenarioId, id: a.service.id },
        }),
  };
}
