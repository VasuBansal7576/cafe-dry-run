import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core/action";

import { getDb } from "../server/db/index.js";
import { scenarios, serviceRuns } from "../server/db/schema.js";
import { createArrivalPlan } from "../server/lib/cafe/arrivals.js";
import {
  expectedDailyArrivals,
  isServicePlanSizeAllowed,
  summarizeService,
} from "../server/lib/cafe/decision.js";
import {
  requireOwner,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioFields,
  scenarioScope,
  toScenario,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";
import { arrivalInputs, serviceInputs } from "../server/lib/cafe/scenario.js";
import {
  serviceParameters,
  serviceRunSchema,
} from "../server/lib/cafe/service-run.js";
import { simulateSeries } from "../server/lib/cafe/simulation.js";

export default defineAction({
  description:
    "Run and save a deterministic Saturday service simulation for a cafe scenario, using its current revision. Returns wait, served, loss, bottleneck and utilization metrics. Read get-simulation for playback.",
  schema: scenarioEditKey.extend(serviceParameters.shape),
  outputSchema: serviceRunSchema.omit({ playback: true }),
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, seed, demandLevel, runCount }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const scope = scenarioScope(id, owner);
    return getDb().transaction(async (tx) => {
      const [row] = await tx
        .select(scenarioFields)
        .from(scenarios)
        .where(scope)
        .for("update");
      if (!row)
        return scenarioErrors.fail(
          "Scenario not found.",
          "scenario_not_found",
          {
            statusCode: 404,
          },
        );
      if (row.revision !== expectedRevision) return scenarioConflict();
      const scenario = toScenario(row);

      const { demand, menuMix } = arrivalInputs(scenario.demand, scenario.shop);
      if (
        !isServicePlanSizeAllowed(
          expectedDailyArrivals(demand, demandLevel),
          runCount,
        )
      ) {
        return scenarioErrors.fail(
          "This test is too large. Reduce demand, the service window, or the number of Saturdays.",
          "invalid_scenario",
        );
      }

      const plan = createArrivalPlan(
        demand,
        menuMix,
        seed,
        runCount,
        demandLevel,
      );
      const result = simulateSeries(serviceInputs(scenario.shop), plan);
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            1,
            id,
            expectedRevision,
            seed,
            demandLevel,
            runCount,
          ]),
        )
        .digest("hex");
      const runId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const run = validateInput(serviceRunSchema, {
        id: runId,
        scenarioId: id,
        scenarioRevision: expectedRevision,
        arrivalSource: { id, revision: expectedRevision },
        summary: summarizeService(scenario, scenario, plan, result),
        playback: result.playback,
      });

      await tx
        .insert(serviceRuns)
        .values({
          ...run,
          ownerEmail: owner,
          arrivalSourceId: id,
          arrivalSourceRevision: expectedRevision,
        })
        .onConflictDoNothing({ target: serviceRuns.id });
      await tx
        .update(scenarios)
        .set({
          demand: row.demand === null ? scenario.demand : undefined,
          shop: row.shop === null ? scenario.shop : undefined,
          latestRunId: runId,
        })
        .where(scope);
      return {
        id: run.id,
        scenarioId: run.scenarioId,
        scenarioRevision: run.scenarioRevision,
        arrivalSource: run.arrivalSource,
        summary: run.summary,
      };
    });
  },
});
