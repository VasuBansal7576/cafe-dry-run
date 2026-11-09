import {
  DEFAULT_TOOL_RESULT_CHARS,
  defineAction,
} from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios, serviceRuns } from "../server/db/schema.js";
import {
  chatFigureBasisSchema,
  serviceFigureBasis,
} from "../server/lib/cafe/chat-figure-basis.js";
import {
  chatFiguresSchema,
  serviceChatFigures,
} from "../server/lib/cafe/chat-figures.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioKey,
  scenarioScope,
} from "../server/lib/cafe/scenario-store.js";
import { sampledArrivalProvenance } from "../server/lib/cafe/scenario.js";
import {
  pairedRunId,
  soloRunId,
} from "../server/lib/cafe/service-run-identity.js";
import {
  servicePlaybackSchema,
  serviceRunSchema,
} from "../server/lib/cafe/service-run.js";
import { fitsToolResult } from "../server/lib/cafe/tool-result-budget.js";

const playbackOffset = z.number().int().nonnegative();
const pageBounds = z.object({
  offset: playbackOffset,
  total: playbackOffset,
  nextOffset: playbackOffset.nullable(),
});
const playbackPageSchema = z.discriminatedUnion("stream", [
  pageBounds.extend({
    stream: z.literal("arrivals"),
    records: servicePlaybackSchema.shape.arrivals,
  }),
  pageBounds.extend({
    stream: z.literal("timeline"),
    records: servicePlaybackSchema.shape.timeline,
  }),
]);

export default defineAction({
  description:
    "Read a saved cafe service run and whether its inputs are stale. Quote chatFigures.text verbatim from a fresh run. To read first-Saturday playback in chat, pass playbackPage with stream arrivals or timeline and offset zero. includePlayback starts an arrivals page in chat. Continue the same stream with the returned run.id and nextOffset. A null nextOffset means that stream is complete.",
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
        "Request full playback in the browser or the first arrivals page in chat",
      ),
    playbackPage: z
      .object({
        stream: z.enum(["arrivals", "timeline"]),
        offset: playbackOffset.default(0),
      })
      .optional()
      .describe(
        "Select one first-Saturday stream and start at its record offset",
      ),
  }),
  outputSchema: z.object({
    chatFigureBasis: chatFigureBasisSchema.nullable(),
    chatFigures: chatFiguresSchema.nullable(),
    run: serviceRunSchema
      .partial({ playback: true })
      .extend({ stale: z.boolean() })
      .nullable(),
    playbackPage: playbackPageSchema.optional(),
  }),
  errors: scenarioErrors,
  http: { method: "GET" },
  readOnly: true,
  maxResultChars: 100_000,
  run: async ({ id, runId, includePlayback, playbackPage }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    if (playbackPage?.offset && runId === undefined)
      return scenarioErrors.fail(
        "Pass the same run ID when continuing a playback stream.",
        "invalid_scenario",
      );
    const includeFullPlayback =
      includePlayback === true || includePlayback === "true";
    const budget = ctx?.maxResultChars;
    const page =
      playbackPage ??
      (budget !== undefined && includeFullPlayback
        ? { stream: "arrivals" as const, offset: 0 }
        : undefined);
    const source = alias(scenarios, "arrival_source");
    const [row] = await getDb()
      .select({
        label: scenarios.label,
        revision: scenarios.revision,
        latestRunId: scenarios.latestRunId,
        runId: serviceRuns.id,
        scenarioRevision: serviceRuns.scenarioRevision,
        arrivalSourceId: serviceRuns.arrivalSourceId,
        arrivalSourceRevision: serviceRuns.arrivalSourceRevision,
        currentArrivalRevision: source.revision,
        currentArrivalDemand: source.demand,
        summary: serviceRuns.summary,
        ...(includeFullPlayback || page
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
      .leftJoin(
        source,
        and(
          eq(source.id, serviceRuns.arrivalSourceId),
          eq(source.ownerEmail, owner),
        ),
      )
      .where(scenarioScope(id, owner));
    if (!row)
      return scenarioErrors.fail("Scenario not found.", "scenario_not_found", {
        statusCode: 404,
      });
    const observations = {
      scenarios: [
        {
          id,
          revision: row.revision,
          ...(runId === undefined && { latestRunId: row.latestRunId }),
        },
        ...(row.arrivalSourceId &&
        row.arrivalSourceId !== id &&
        row.currentArrivalRevision !== null
          ? [{ id: row.arrivalSourceId, revision: row.currentArrivalRevision }]
          : []),
      ],
    };
    if (
      !row.runId ||
      row.scenarioRevision === null ||
      !row.summary ||
      !row.arrivalSourceId ||
      row.arrivalSourceRevision === null
    )
      return {
        chatFigureBasis: { scenarios: [], observations },
        chatFigures: null,
        run: null,
      };
    const scenario = { id, revision: row.scenarioRevision };
    const arrivalSource = {
      id: row.arrivalSourceId,
      revision: row.arrivalSourceRevision,
    };
    const currentRunId =
      row.runId === soloRunId(scenario, row.summary) ||
      row.runId === pairedRunId(scenario, arrivalSource, row.summary);
    const stale =
      !currentRunId ||
      row.scenarioRevision !== row.revision ||
      row.arrivalSourceRevision !== row.currentArrivalRevision;
    const summary =
      row.summary.arrivalProvenance === undefined &&
      currentRunId &&
      row.arrivalSourceRevision === row.currentArrivalRevision &&
      row.currentArrivalDemand
        ? {
            ...row.summary,
            arrivalProvenance: sampledArrivalProvenance(
              row.currentArrivalDemand,
              row.summary.demandLevel,
            ),
          }
        : row.summary;
    const run = {
      id: row.runId,
      scenarioId: id,
      scenarioRevision: row.scenarioRevision,
      arrivalSource,
      summary,
      playback: page ? undefined : (row.playback ?? undefined),
      stale,
    };
    const result = {
      chatFigureBasis: {
        ...serviceFigureBasis(run),
        observations,
        ...(runId === undefined && {
          latestRun: { scenarioId: id, id: run.id },
        }),
      },
      chatFigures: stale ? null : serviceChatFigures(row.summary, row.label),
      run,
    };
    const playback = row.playback;
    if (page && playback) {
      const { stream, offset } = page;
      const total = playback[stream].length;
      if (offset > total)
        return scenarioErrors.fail(
          "The playback offset is past the end of this stream.",
          "invalid_scenario",
        );
      const limit = budget ?? DEFAULT_TOOL_RESULT_CHARS;
      let count = Math.min(128, total - offset);
      do {
        const end = offset + count;
        const bounds = { offset, total, nextOffset: end < total ? end : null };
        const paged = {
          ...result,
          playbackPage:
            stream === "arrivals"
              ? {
                  ...bounds,
                  stream,
                  records: playback.arrivals.slice(offset, end),
                }
              : {
                  ...bounds,
                  stream,
                  records: playback.timeline.slice(offset, end),
                },
        };
        if (fitsToolResult(paged, limit)) return paged;
        count = Math.floor(count / 2);
      } while (count > 0);
    } else if (budget === undefined || fitsToolResult(result, budget)) {
      return result;
    }
    return scenarioErrors.fail(
      "The service result exceeds this agent's tool result limit. Read the run in the café.",
      "invalid_scenario",
    );
  },
});
