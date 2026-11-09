import { z } from "zod";

import type { DecisionReceipt, StoredDecision } from "./decision-receipt.js";
import { savedCustomerAssumptionSchema } from "./finance.js";
import type { ServiceRun } from "./service-run.js";

const id = z.uuid();
const revision = z.number().int().nonnegative();
const scenarioVersion = z.object({
  id,
  revision: revision.optional(),
  financeRevision: revision.optional(),
});
const assumptionVersion = z.object({
  pair: z.string(),
  revision,
  savedCustomers: savedCustomerAssumptionSchema,
});
const observationSchema = z.object({
  scenarios: z.array(
    scenarioVersion.extend({ latestRunId: id.nullable().optional() }),
  ),
  assumption: assumptionVersion.optional(),
});
export const chatFigureBasisSchema = z.object({
  scenarios: z.array(scenarioVersion),
  runIds: z.array(id).optional(),
  latestRun: z.object({ scenarioId: id, id }).optional(),
  receiptId: id.optional(),
  assumption: assumptionVersion.optional(),
  observations: observationSchema.optional(),
});
export type ChatFigureBasis = z.infer<typeof chatFigureBasisSchema>;
export type ChatFigureObservations = z.infer<typeof observationSchema>;
export type ObservedDecision = StoredDecision & {
  quoteObservations: ChatFigureObservations;
};

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

function pairAssumption({
  a,
  b,
  assumptionRevision,
  savedCustomers,
}: DecisionReceipt) {
  return b
    ? {
        pair: [a.service.scenarioId, b.service.scenarioId].sort().join(":"),
        revision: assumptionRevision ?? 0,
        savedCustomers,
      }
    : undefined;
}

export function decisionObservations(
  scenarios: ChatFigureObservations["scenarios"],
  latestAssumption: DecisionReceipt,
): ChatFigureObservations {
  return { scenarios, assumption: pairAssumption(latestAssumption) };
}

export function decisionFigureBasis({
  receipt,
  quoteObservations,
}: ObservedDecision): ChatFigureBasis {
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
      ? { assumption: pairAssumption(receipt) }
      : {
          latestRun: { scenarioId: a.service.scenarioId, id: a.service.id },
        }),
    observations: quoteObservations,
  };
}
