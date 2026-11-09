import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  playbackBounds,
  type PlaybackIdentity,
} from "../../../shared/cafe/playback-position.js";
import { getDb } from "../../db/index.js";
import { scenarios, serviceRuns } from "../../db/schema.js";
import { readDecision } from "./decision-store.js";
import { pairedRunId, soloRunId } from "./service-run-identity.js";

async function readPlaybackRun(owner: string, id: string, runId: string) {
  const source = alias(scenarios, "playback_arrival_source");
  const [row] = await getDb()
    .select({
      summary: serviceRuns.summary,
      latestRunId: scenarios.latestRunId,
      revision: scenarios.revision,
      sourceId: source.id,
      sourceRevision: source.revision,
      lastEvent: sql<number>`coalesce((${serviceRuns.playback}->'timeline'->-1->>'at')::double precision, 0)`,
    })
    .from(serviceRuns)
    .innerJoin(
      scenarios,
      and(
        eq(scenarios.id, serviceRuns.scenarioId),
        eq(scenarios.ownerEmail, owner),
        eq(scenarios.revision, serviceRuns.scenarioRevision),
      ),
    )
    .innerJoin(
      source,
      and(
        eq(source.id, serviceRuns.arrivalSourceId),
        eq(source.ownerEmail, owner),
        eq(source.revision, serviceRuns.arrivalSourceRevision),
      ),
    )
    .where(
      and(
        eq(serviceRuns.ownerEmail, owner),
        eq(serviceRuns.scenarioId, id),
        eq(serviceRuns.id, runId),
      ),
    );
  return row;
}

export async function currentPlaybackBounds(
  owner: string,
  identity: PlaybackIdentity,
) {
  const {
    scenarioId: aId,
    runId,
    receiptId,
    comparisonScenarioId: bId,
    comparisonRunId,
  } = identity;
  if (!bId) {
    if (receiptId || comparisonRunId) return;
    const a = await readPlaybackRun(owner, aId, runId);
    if (
      a?.latestRunId !== runId ||
      soloRunId({ id: aId, revision: a.revision }, a.summary) !== runId
    )
      return;
    return playbackBounds(a.summary.hours, [a.lastEvent]);
  }
  if (!receiptId || !comparisonRunId || aId === bId) return;
  const decision = await readDecision(owner, { aId, bId });
  if (
    !decision ||
    decision.serviceStale ||
    decision.receipt.id !== receiptId ||
    decision.receipt.a.service.id !== runId ||
    decision.receipt.b?.service.id !== comparisonRunId
  )
    return;
  const [a, b] = await Promise.all([
    readPlaybackRun(owner, aId, runId),
    readPlaybackRun(owner, bId, comparisonRunId),
  ]);
  if (!a || !b) return;
  if (
    pairedRunId(
      { id: aId, revision: a.revision },
      { id: a.sourceId, revision: a.sourceRevision },
      a.summary,
    ) !== runId ||
    pairedRunId(
      { id: bId, revision: b.revision },
      { id: b.sourceId, revision: b.sourceRevision },
      b.summary,
    ) !== comparisonRunId
  )
    return;
  return playbackBounds(a.summary.hours, [a.lastEvent, b.lastEvent]);
}
