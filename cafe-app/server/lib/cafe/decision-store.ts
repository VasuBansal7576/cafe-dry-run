import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import { decisionRuns, scenarios, serviceRuns } from "../../db/schema.js";
import {
  decisionReceiptSchema,
  type StoredDecision,
} from "./decision-receipt.js";
import { calculateDecision, type DecisionParameters } from "./decision.js";
import {
  defaultSavedCustomers,
  type SavedCustomerAssumption,
} from "./finance.js";
import {
  scenarioConflict,
  scenarioErrors,
  scenarioFields,
  scenarioVersionKey,
  toScenario,
  validateInput,
  type Scenario,
} from "./scenario-store.js";
import { serviceRunSchema } from "./service-run.js";

export const decisionScopeSchema = z.object({
  aId: z
    .string()
    .uuid()
    .describe("Baseline scenario ID. Supplies all matched arrival records."),
  bId: z
    .string()
    .uuid()
    .optional()
    .describe("Alternative scenario ID. Omit for a standalone runway."),
  receiptId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Specific saved receipt ID. Defaults to the latest receipt for these scenarios.",
    ),
});

type Version = z.infer<typeof scenarioVersionKey>;

function verifyVersion(
  scenario: Scenario | undefined,
  version: Version,
): Scenario {
  if (
    !scenario ||
    scenario.revision !== version.expectedRevision ||
    scenario.financeRevision !== version.expectedFinanceRevision
  ) {
    return scenarioConflict();
  }
  return scenario;
}

function pairedRunId(
  scenario: Scenario,
  arrivalScenario: Scenario,
  settings: DecisionParameters,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "paired-v1",
        scenario.id,
        scenario.revision,
        arrivalScenario.id,
        arrivalScenario.revision,
        settings.seed,
        settings.runCount,
        settings.demandLevel,
      ]),
    )
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

type DecisionRequest =
  | {
      a: Version;
      b: Version;
      settings: DecisionParameters;
      savedCustomers?: SavedCustomerAssumption;
    }
  | { a: Version; runId: string };

export async function saveDecision(
  owner: string,
  request: DecisionRequest,
): Promise<StoredDecision> {
  return getDb().transaction(async (tx) => {
    const paired = "b" in request;
    const ids = paired ? [request.a.id, request.b.id] : [request.a.id];
    if (paired && request.a.id === request.b.id) {
      return scenarioErrors.fail(
        "Choose a different scenario for B.",
        "invalid_scenario",
      );
    }
    const rows = await tx
      .select(scenarioFields)
      .from(scenarios)
      .where(and(eq(scenarios.ownerEmail, owner), inArray(scenarios.id, ids)))
      .orderBy(scenarios.id)
      .for("update");
    const inputs = new Map(rows.map((row) => [row.id, toScenario(row)]));
    const a = verifyVersion(inputs.get(request.a.id), request.a);
    const b = paired
      ? verifyVersion(inputs.get(request.b.id), request.b)
      : null;
    const scope = and(
      eq(decisionRuns.ownerEmail, owner),
      eq(decisionRuns.aScenarioId, a.id),
      b ? eq(decisionRuns.bScenarioId, b.id) : isNull(decisionRuns.bScenarioId),
    );
    let settings: DecisionParameters;
    let savedCustomers = defaultSavedCustomers;
    if (paired) {
      settings = request.settings;
      if (request.savedCustomers) {
        savedCustomers = request.savedCustomers;
      } else {
        const [prior] = await tx
          .select({ receipt: decisionRuns.receipt })
          .from(decisionRuns)
          .where(scope)
          .orderBy(desc(decisionRuns.sequence))
          .limit(1);
        savedCustomers = prior?.receipt.savedCustomers ?? savedCustomers;
      }
    } else {
      if (a.latestRunId !== request.runId) return scenarioConflict();
      const [run] = await tx
        .select({
          summary: serviceRuns.summary,
          revision: serviceRuns.scenarioRevision,
        })
        .from(serviceRuns)
        .where(
          and(
            eq(serviceRuns.id, request.runId),
            eq(serviceRuns.scenarioId, a.id),
            eq(serviceRuns.ownerEmail, owner),
          ),
        );
      if (!run || run.revision !== a.revision) {
        return scenarioErrors.fail(
          "Run a fresh Saturday simulation before computing this runway.",
          "invalid_scenario",
        );
      }
      settings = {
        seed: run.summary.seed,
        demandLevel: run.summary.demandLevel,
        runCount: run.summary.runCount,
      };
    }

    let calculated: ReturnType<typeof calculateDecision>;
    try {
      calculated = calculateDecision(a, b, settings, savedCustomers);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return scenarioErrors.fail(error.message, "invalid_scenario");
    }

    const runA = validateInput(serviceRunSchema, {
      id: paired ? pairedRunId(a, a, settings) : request.runId,
      scenarioId: a.id,
      scenarioRevision: a.revision,
      ...calculated.serviceA,
    });
    const runB =
      b && calculated.serviceB
        ? validateInput(serviceRunSchema, {
            id: pairedRunId(b, a, settings),
            scenarioId: b.id,
            scenarioRevision: b.revision,
            ...calculated.serviceB,
          })
        : null;
    const withoutPlayback = ({
      id,
      scenarioId,
      scenarioRevision,
      summary,
    }: typeof runA) => ({ id, scenarioId, scenarioRevision, summary });
    const receipt = validateInput(decisionReceiptSchema, {
      id: crypto.randomUUID(),
      settings,
      savedCustomers,
      a: {
        label: a.label,
        finance: a.finance,
        financeRevision: a.financeRevision,
        service: withoutPlayback(runA),
        weekendLosses: calculated.weekendLossA,
        cash: calculated.cashA,
      },
      b:
        b && runB
          ? {
              label: b.label,
              finance: b.finance,
              financeRevision: b.financeRevision,
              service: withoutPlayback(runB),
              weekendLosses: calculated.weekendLossB,
              cash: calculated.cashB,
            }
          : null,
      weekendDemand: calculated.weekendDemand,
      weekend: calculated.weekend,
      delta: calculated.delta,
    });
    if (runB) {
      await tx
        .insert(serviceRuns)
        .values([
          { ...runA, ownerEmail: owner },
          { ...runB, ownerEmail: owner },
        ])
        .onConflictDoNothing({ target: serviceRuns.id });
    }
    await tx.insert(decisionRuns).values({
      id: receipt.id,
      ownerEmail: owner,
      aScenarioId: a.id,
      bScenarioId: b?.id,
      receipt,
    });
    return { receipt, serviceStale: false, cashStale: false };
  });
}

export async function readDecision(
  owner: string,
  { aId, bId, receiptId }: z.infer<typeof decisionScopeSchema>,
): Promise<StoredDecision | null> {
  const b = alias(scenarios, "b_scenario");
  const [row] = await getDb()
    .select({
      receipt: decisionRuns.receipt,
      aRevision: scenarios.revision,
      aFinanceRevision: scenarios.financeRevision,
      aLatestRunId: scenarios.latestRunId,
      bRevision: b.revision,
      bFinanceRevision: b.financeRevision,
    })
    .from(decisionRuns)
    .innerJoin(
      scenarios,
      and(
        eq(scenarios.id, decisionRuns.aScenarioId),
        eq(scenarios.ownerEmail, owner),
      ),
    )
    .leftJoin(
      b,
      and(eq(b.id, decisionRuns.bScenarioId), eq(b.ownerEmail, owner)),
    )
    .where(
      and(
        eq(decisionRuns.ownerEmail, owner),
        eq(decisionRuns.aScenarioId, aId),
        bId
          ? eq(decisionRuns.bScenarioId, bId)
          : isNull(decisionRuns.bScenarioId),
        receiptId ? eq(decisionRuns.id, receiptId) : undefined,
      ),
    )
    .orderBy(desc(decisionRuns.sequence))
    .limit(1);
  if (!row) return null;
  const { receipt } = row;
  const serviceStale =
    receipt.a.service.scenarioRevision !== row.aRevision ||
    (receipt.b
      ? receipt.b.service.scenarioRevision !== row.bRevision
      : receipt.a.service.id !== row.aLatestRunId);
  const cashStale =
    serviceStale ||
    receipt.a.financeRevision !== row.aFinanceRevision ||
    (!!receipt.b && receipt.b.financeRevision !== row.bFinanceRevision);
  return { receipt, serviceStale, cashStale };
}
