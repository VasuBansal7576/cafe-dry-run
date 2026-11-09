import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios, serviceRuns } from "../server/db/schema.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioKey,
  scenarioScope,
} from "../server/lib/cafe/scenario-store.js";
import { serviceRunSchema } from "../server/lib/cafe/service-run.js";

export default defineAction({
  description:
    "Read a saved cafe service run and whether its inputs are stale. Defaults to the scenario's latest run. Include playback only when you need the first Saturday's arrivals and timeline.",
  schema: scenarioKey.extend({
    runId: z
      .string()
      .uuid()
      .optional()
      .describe("Specific run ID, or omit to use the latest run"),
    includePlayback: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .default(false)
      .describe(
        "Set to true to include the recorded arrival and service timeline",
      ),
  }),
  outputSchema: z.object({
    run: serviceRunSchema
      .partial({ playback: true })
      .extend({ stale: z.boolean() })
      .nullable(),
  }),
  errors: scenarioErrors,
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id, runId, includePlayback }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const [row] = await getDb()
      .select({
        revision: scenarios.revision,
        runId: serviceRuns.id,
        scenarioRevision: serviceRuns.scenarioRevision,
        summary: serviceRuns.summary,
        ...(includePlayback === true || includePlayback === "true"
          ? { playback: serviceRuns.playback }
          : {}),
      })
      .from(scenarios)
      .leftJoin(
        serviceRuns,
        and(
          eq(serviceRuns.scenarioId, scenarios.id),
          eq(serviceRuns.ownerEmail, owner),
          eq(serviceRuns.id, runId ?? scenarios.latestRunId),
        ),
      )
      .where(scenarioScope(id, owner));
    if (!row)
      return scenarioErrors.fail("Scenario not found.", "scenario_not_found", {
        statusCode: 404,
      });
    if (!row.runId || row.scenarioRevision === null || !row.summary)
      return { run: null };
    return {
      run: {
        id: row.runId,
        scenarioId: id,
        scenarioRevision: row.scenarioRevision,
        summary: row.summary,
        playback: row.playback ?? undefined,
        stale: row.scenarioRevision !== row.revision,
      },
    };
  },
});
