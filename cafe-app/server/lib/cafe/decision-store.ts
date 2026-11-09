import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb } from "../../db/index.js";
import { decisionRuns, scenarios, serviceRuns } from "../../db/schema.js";
import {
  decisionObservations,
  type ObservedDecision,
} from "./chat-figure-basis.js";
import {
  decisionReceiptSchema,
  type DecisionReceipt,
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
  scenarioScope,
  scenarioVersionKey,
  toScenario,
  validateInput,
  type Scenario,
} from "./scenario-store.js";
import { pedestrianDailyArrivals } from "./scenario.js";
import {
  matchesPairedRunId,
  pairedRunId,
  pairedRunVersion,
} from "./service-run-identity.js";
import { serviceRunSchema } from "./service-run.js";

export const decisionScopeSchema = z.object({
  aId: z.string().uuid().describe("Scenario shown as A."),
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

function restoreReceiptArrivalSources(
  receipt: DecisionReceipt,
): DecisionReceipt {
  if (receipt.a.service.summary.arrivalProvenance !== undefined) return receipt;
  // Earlier receipts used the sample source for their expected daily total.
  const arrivalProvenance =
    receipt.weekendDemand[receipt.settings.demandLevel].tag;
  const withSample = (side: DecisionReceipt["a"]) => ({
    ...side,
    service: {
      ...side.service,
      summary: { ...side.service.summary, arrivalProvenance },
    },
  });
  const counted =
    receipt.pedestrian && pedestrianDailyArrivals(receipt.pedestrian);
  const weekendDemand =
    counted &&
    Object.values(receipt.weekendDemand).every(
      ({ value }) => value === counted.value,
    )
      ? { low: counted, base: counted, high: counted }
      : receipt.weekendDemand;
  return {
    ...receipt,
    weekendDemand,
    a: withSample(receipt.a),
    b: receipt.b ? withSample(receipt.b) : null,
  };
}

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

type DecisionRequest =
  | ({
      a: Version;
      b: Version;
      savedCustomers?: SavedCustomerAssumption;
    } & (
      | { settings: DecisionParameters; expectedReceiptId?: string }
      | { receiptId: string }
    ))
  | { a: Version; runId: string };

function sharedBaselineId(
  aId: string,
  bId: string,
  parents: Map<string, string | null>,
) {
  function lineage(id: string) {
    const ancestors = new Set<string>();
    let current: string | null = id;
    while (current && parents.has(current) && !ancestors.has(current)) {
      ancestors.add(current);
      current = parents.get(current) ?? null;
    }
    return ancestors;
  }
  const bLineage = lineage(bId);
  return [...lineage(aId)].find((id) => bLineage.has(id)) ?? aId;
}

function decisionScope(owner: string, aId: string, bId?: string) {
  return and(
    eq(decisionRuns.ownerEmail, owner),
    eq(decisionRuns.aScenarioId, aId),
    bId ? eq(decisionRuns.bScenarioId, bId) : isNull(decisionRuns.bScenarioId),
  );
}

function assumptionScope(owner: string, aId: string, bId?: string) {
  const forward = decisionScope(owner, aId, bId);
  return bId ? or(forward, decisionScope(owner, bId, aId)) : forward;
}

export async function readArrivalSource(
  owner: string,
  aId: string,
  bId: string,
) {
  const db = getDb();
  const links = await db
    .select({ id: scenarios.id, parentId: scenarios.parentId })
    .from(scenarios)
    .where(eq(scenarios.ownerEmail, owner));
  const parents = new Map(links.map(({ id, parentId }) => [id, parentId]));
  if (!parents.has(aId) || !parents.has(bId) || aId === bId) return null;
  const [row] = await db
    .select(scenarioFields)
    .from(scenarios)
    .where(
      and(
        eq(scenarios.ownerEmail, owner),
        eq(scenarios.id, sharedBaselineId(aId, bId, parents)),
      ),
    );
  if (!row) return null;
  const { id, revision, label, demand } = toScenario(row);
  return { id, revision, label, demand };
}

export async function saveDecision(
  owner: string,
  request: DecisionRequest,
): Promise<ObservedDecision> {
  return getDb().transaction(async (tx) => {
    const paired = "b" in request;
    if (paired && request.a.id === request.b.id) {
      return scenarioErrors.fail(
        "Choose a different scenario for B.",
        "invalid_scenario",
      );
    }
    let baselineId = request.a.id;
    if (paired) {
      const links = await tx
        .select({ id: scenarios.id, parentId: scenarios.parentId })
        .from(scenarios)
        .where(eq(scenarios.ownerEmail, owner));
      baselineId = sharedBaselineId(
        request.a.id,
        request.b.id,
        new Map(links.map(({ id, parentId }) => [id, parentId])),
      );
    }
    const ids = paired
      ? [request.a.id, request.b.id, baselineId]
      : [request.a.id];
    const rows = await tx
      .select(scenarioFields)
      .from(scenarios)
      .where(and(eq(scenarios.ownerEmail, owner), inArray(scenarios.id, ids)))
      .orderBy(scenarios.id)
      .for("update");
    const inputs = new Map(
      rows.map((row) => [row.id, { row, scenario: toScenario(row) }]),
    );
    const a = verifyVersion(inputs.get(request.a.id)?.scenario, request.a);
    const b = paired
      ? verifyVersion(inputs.get(request.b.id)?.scenario, request.b)
      : null;
    const baseline = inputs.get(baselineId)?.scenario ?? scenarioConflict();
    let settings: DecisionParameters;
    let matchedReceipt: DecisionReceipt | undefined;
    let savedCustomers = defaultSavedCustomers;
    let assumptionRevision = 0;
    if (paired) {
      const [prior] = await tx
        .select({ receipt: decisionRuns.receipt })
        .from(decisionRuns)
        .where(assumptionScope(owner, a.id, b?.id))
        .orderBy(desc(decisionRuns.sequence))
        .limit(1);
      const previous = prior?.receipt.savedCustomers ?? defaultSavedCustomers;
      savedCustomers = request.savedCustomers ?? previous;
      assumptionRevision = prior?.receipt.assumptionRevision ?? 0;
      async function latestOrderedReceipt() {
        if (prior?.receipt.a.service.scenarioId === a.id) return prior.receipt;
        const [latest] = await tx
          .select({ receipt: decisionRuns.receipt })
          .from(decisionRuns)
          .where(decisionScope(owner, a.id, b?.id))
          .orderBy(desc(decisionRuns.sequence))
          .limit(1);
        return latest?.receipt;
      }
      if ("receiptId" in request) {
        const latest = await latestOrderedReceipt();
        if (latest?.id !== request.receiptId) {
          return scenarioErrors.fail(
            "Read the latest receipt for this pair before refreshing its cash projection.",
            "scenario_conflict",
            { statusCode: 409 },
          );
        }
        if (
          !b ||
          latest.pairedRunVersion !== pairedRunVersion ||
          latest.cashBaseline?.id !== baseline.id ||
          latest.cashBaseline.revision !== baseline.revision ||
          !matchesPairedRunId(
            latest.a.service.id,
            a,
            baseline,
            latest.settings,
          ) ||
          !latest.b ||
          !matchesPairedRunId(latest.b.service.id, b, baseline, latest.settings)
        ) {
          return scenarioErrors.fail(
            "Run a fresh Saturday comparison before computing this runway.",
            "invalid_scenario",
          );
        }
        const runs = await tx
          .select({ id: serviceRuns.id })
          .from(serviceRuns)
          .where(
            and(
              eq(serviceRuns.ownerEmail, owner),
              inArray(serviceRuns.id, [
                latest.a.service.id,
                latest.b.service.id,
              ]),
              eq(serviceRuns.arrivalSourceId, baseline.id),
              eq(serviceRuns.arrivalSourceRevision, baseline.revision),
            ),
          );
        if (runs.length !== 2) {
          return scenarioErrors.fail(
            "Run a fresh Saturday comparison before computing this runway.",
            "invalid_scenario",
          );
        }
        if (
          request.savedCustomers &&
          (latest.assumptionRevision ?? 0) !== assumptionRevision
        ) {
          return scenarioErrors.fail(
            "The saved-customer assumption changed. Refresh the cash projection before editing it.",
            "scenario_conflict",
            { statusCode: 409 },
          );
        }
        settings = latest.settings;
        matchedReceipt = latest;
      } else {
        if (
          request.expectedReceiptId !== undefined &&
          (await latestOrderedReceipt())?.id !== request.expectedReceiptId
        )
          return scenarioErrors.fail(
            "The comparison was updated elsewhere. Retry to check its current settings.",
            "scenario_conflict",
            { statusCode: 409 },
          );
        settings = request.settings;
      }
      if (
        savedCustomers.enabled !== previous.enabled ||
        savedCustomers.tag !== previous.tag
      ) {
        assumptionRevision += 1;
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
      calculated = calculateDecision(a, b, settings, savedCustomers, baseline);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return scenarioErrors.fail(error.message, "invalid_scenario");
    }

    const arrivalSource = { id: baseline.id, revision: baseline.revision };
    const runA = validateInput(serviceRunSchema, {
      id: paired ? pairedRunId(a, baseline, settings) : request.runId,
      scenarioId: a.id,
      scenarioRevision: a.revision,
      arrivalSource,
      ...calculated.serviceA,
    });
    const runB =
      b && calculated.serviceB
        ? validateInput(serviceRunSchema, {
            id: pairedRunId(b, baseline, settings),
            scenarioId: b.id,
            scenarioRevision: b.revision,
            arrivalSource,
            ...calculated.serviceB,
          })
        : null;
    const serviceSnapshot = (
      { id, scenarioId, scenarioRevision, arrivalSource, summary }: typeof runA,
      saved?: DecisionReceipt["a"]["service"],
    ) =>
      saved
        ? {
            ...saved,
            summary: {
              ...saved.summary,
              arrivalProvenance: summary.arrivalProvenance,
            },
          }
        : { id, scenarioId, scenarioRevision, arrivalSource, summary };
    const receipt = validateInput(decisionReceiptSchema, {
      id: crypto.randomUUID(),
      settings,
      savedCustomers,
      pedestrian: baseline.demand.pedestrian ?? null,
      assumptionRevision,
      pairedRunVersion: paired ? pairedRunVersion : undefined,
      cashBaseline: {
        ...arrivalSource,
        label: baseline.label,
        weekendLosses: calculated.baselineLosses,
      },
      a: {
        label: a.label,
        finance: a.finance,
        financeRevision: a.financeRevision,
        service: serviceSnapshot(runA, matchedReceipt?.a.service),
        weekendLosses: calculated.weekendLossA,
        cash: calculated.cashA,
      },
      b:
        b && runB
          ? {
              label: b.label,
              finance: b.finance,
              financeRevision: b.financeRevision,
              service: serviceSnapshot(runB, matchedReceipt?.b?.service),
              weekendLosses: calculated.weekendLossB,
              cash: calculated.cashB,
            }
          : null,
      weekendDemand: calculated.weekendDemand,
      weekend: calculated.weekend,
      delta: calculated.delta,
    });
    if (runB && !matchedReceipt) {
      for (const { row, scenario } of inputs.values()) {
        if (row.demand !== null && row.shop !== null) continue;
        await tx
          .update(scenarios)
          .set({
            demand: row.demand === null ? scenario.demand : undefined,
            shop: row.shop === null ? scenario.shop : undefined,
          })
          .where(scenarioScope(row.id, owner));
      }
      await tx
        .insert(serviceRuns)
        .values([
          {
            ...runA,
            ownerEmail: owner,
            arrivalSourceId: baseline.id,
            arrivalSourceRevision: baseline.revision,
          },
          {
            ...runB,
            ownerEmail: owner,
            arrivalSourceId: baseline.id,
            arrivalSourceRevision: baseline.revision,
          },
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
    return {
      receipt,
      serviceStale: false,
      cashStale: false,
      historical: false,
      assumptionStale: false,
      currentSavedCustomers: savedCustomers,
      quoteObservations: decisionObservations(
        [
          ...(b ? [a, b] : [a]).map(
            ({ id, revision, financeRevision, latestRunId }) => ({
              id,
              revision,
              financeRevision,
              latestRunId,
            }),
          ),
          arrivalSource,
        ],
        receipt,
      ),
    };
  });
}

export async function readDecision(
  owner: string,
  { aId, bId, receiptId }: z.infer<typeof decisionScopeSchema>,
): Promise<ObservedDecision | null> {
  const b = alias(scenarios, "b_scenario");
  const source = alias(scenarios, "arrival_source");
  const db = getDb();
  const scope = decisionScope(owner, aId, bId);
  const assumptionSequence = db
    .select({ sequence: decisionRuns.sequence })
    .from(decisionRuns)
    .where(assumptionScope(owner, aId, bId))
    .orderBy(desc(decisionRuns.sequence))
    .limit(1);
  const latestSequence = db
    .select({ sequence: decisionRuns.sequence })
    .from(decisionRuns)
    .where(scope)
    .orderBy(desc(decisionRuns.sequence))
    .limit(1);
  const rows = await db
    .select({
      receipt: decisionRuns.receipt,
      isLatestForOrder: sql<boolean>`${decisionRuns.sequence} = (${latestSequence})`,
      isLatestAssumption: sql<boolean>`${decisionRuns.sequence} = (${assumptionSequence})`,
      aRevision: scenarios.revision,
      aFinanceRevision: scenarios.financeRevision,
      aLatestRunId: scenarios.latestRunId,
      bRevision: b.revision,
      bFinanceRevision: b.financeRevision,
      bLatestRunId: b.latestRunId,
      arrivalRevision: source.revision,
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
    .leftJoin(
      source,
      and(
        eq(source.id, sql`${decisionRuns.receipt}->'cashBaseline'->>'id'`),
        eq(source.ownerEmail, owner),
      ),
    )
    .where(
      or(
        eq(decisionRuns.sequence, latestSequence),
        eq(decisionRuns.sequence, assumptionSequence),
        receiptId ? and(scope, eq(decisionRuns.id, receiptId)) : undefined,
      ),
    );
  const latest = rows.find((row) => row.isLatestForOrder);
  const assumption = rows.find((row) => row.isLatestAssumption);
  const row = receiptId
    ? rows.find(
        (row) =>
          row.receipt.id === receiptId &&
          row.receipt.a.service.scenarioId === aId &&
          (row.receipt.b?.service.scenarioId ?? undefined) === bId,
      )
    : latest;
  if (!row || !assumption) return null;
  const receipt = restoreReceiptArrivalSources(row.receipt);
  const currentSavedCustomers = assumption.receipt.savedCustomers;
  const assumptionStale =
    (receipt.assumptionRevision ?? 0) !==
      (assumption.receipt.assumptionRevision ?? 0) ||
    receipt.savedCustomers.enabled !== currentSavedCustomers.enabled ||
    receipt.savedCustomers.tag !== currentSavedCustomers.tag;
  const historical = !row.isLatestForOrder || assumptionStale;
  const serviceStale =
    (!!receipt.b && receipt.pairedRunVersion !== pairedRunVersion) ||
    receipt.a.service.scenarioRevision !== row.aRevision ||
    (!!receipt.cashBaseline &&
      receipt.cashBaseline.revision !== row.arrivalRevision) ||
    (receipt.b
      ? receipt.b.service.scenarioRevision !== row.bRevision
      : receipt.a.service.id !== row.aLatestRunId);
  const cashStale =
    serviceStale ||
    assumptionStale ||
    !receipt.a.cash.assumptions.breakEvenWeekendMix ||
    (!!receipt.b && !receipt.cashBaseline) ||
    receipt.a.financeRevision !== row.aFinanceRevision ||
    (!!receipt.b && receipt.b.financeRevision !== row.bFinanceRevision);
  return {
    receipt,
    serviceStale,
    cashStale,
    historical,
    assumptionStale,
    currentSavedCustomers,
    quoteObservations: decisionObservations(
      [
        {
          id: receipt.a.service.scenarioId,
          revision: row.aRevision,
          financeRevision: row.aFinanceRevision,
          latestRunId: row.aLatestRunId,
        },
        ...(receipt.b && row.bRevision !== null && row.bFinanceRevision !== null
          ? [
              {
                id: receipt.b.service.scenarioId,
                revision: row.bRevision,
                financeRevision: row.bFinanceRevision,
                latestRunId: row.bLatestRunId,
              },
            ]
          : []),
        ...(receipt.cashBaseline && row.arrivalRevision !== null
          ? [{ id: receipt.cashBaseline.id, revision: row.arrivalRevision }]
          : []),
      ],
      assumption.receipt,
    ),
  };
}
