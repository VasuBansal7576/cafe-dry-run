import {
  appStateCompareAndSetMany,
  appStateGetMany,
  appStateKeyForBrowserTab,
  getCurrentRequestBrowserTabId,
} from "@agent-native/core/application-state";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import {
  changePlayback,
  initialPlaybackSecond,
  playbackBounds,
  playbackStateSchema,
  restorePlayback,
  type PlaybackChange,
  type PlaybackIdentity,
  type PlaybackState,
} from "../../../shared/cafe/playback-position.js";
import { getDb } from "../../db/index.js";
import { scenarios, serviceRuns } from "../../db/schema.js";
import { readDecision } from "./decision-store.js";
import { scenarioErrors } from "./scenario-store.js";
import {
  matchesPairedRunId,
  matchesSoloRunId,
} from "./service-run-identity.js";

async function readPlaybackRun(owner: string, id: string, runId: string) {
  const source = alias(scenarios, "playback_arrival_source");
  const [row] = await getDb()
    .select({
      summary: serviceRuns.summary,
      latestRunId: scenarios.latestRunId,
      revision: scenarios.revision,
      runRevision: serviceRuns.scenarioRevision,
      sourceId: source.id,
      sourceRevision: source.revision,
      runSourceRevision: serviceRuns.arrivalSourceRevision,
      lastEvent: sql<
        number | null
      >`(${serviceRuns.playback}->'timeline'->-1->>'at')::double precision`,
    })
    .from(serviceRuns)
    .innerJoin(
      scenarios,
      and(
        eq(scenarios.id, serviceRuns.scenarioId),
        eq(scenarios.ownerEmail, owner),
      ),
    )
    .innerJoin(
      source,
      and(
        eq(source.id, serviceRuns.arrivalSourceId),
        eq(source.ownerEmail, owner),
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

function currentRevisions(
  run: NonNullable<Awaited<ReturnType<typeof readPlaybackRun>>>,
) {
  return (
    run.revision === run.runRevision &&
    run.sourceRevision === run.runSourceRevision
  );
}

function resultBounds(
  a: NonNullable<Awaited<ReturnType<typeof readPlaybackRun>>>,
  b?: NonNullable<Awaited<ReturnType<typeof readPlaybackRun>>>,
) {
  const bounds = playbackBounds(a.summary.hours, [
    a.lastEvent ?? 0,
    b?.lastEvent ?? 0,
  ]);
  return {
    ...bounds,
    initial: initialPlaybackSecond(bounds, a.lastEvent !== null),
  };
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
    historical,
  } = identity;
  if (!bId) {
    if (receiptId || comparisonRunId) return;
    const a = await readPlaybackRun(owner, aId, runId);
    if (a?.latestRunId !== runId) return;
    const current =
      currentRevisions(a) &&
      matchesSoloRunId(runId, { id: aId, revision: a.revision }, a.summary);
    if (current === !historical) return resultBounds(a);
    return;
  }
  if (!receiptId || !comparisonRunId || aId === bId) return;
  const decision = await readDecision(owner, { aId, bId });
  if (
    !decision ||
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
  const current =
    !decision.serviceStale &&
    currentRevisions(a) &&
    currentRevisions(b) &&
    matchesPairedRunId(
      runId,
      { id: aId, revision: a.revision },
      { id: a.sourceId, revision: a.sourceRevision },
      a.summary,
    ) &&
    matchesPairedRunId(
      comparisonRunId,
      { id: bId, revision: b.revision },
      { id: b.sourceId, revision: b.sourceRevision },
      b.summary,
    );
  if (current === !historical) return resultBounds(a, b);
}

export const playbackWriteOptions = {
  observedSeekId: z.uuid().nullable().optional(),
  observedClockRevision: z.number().int().nonnegative().optional(),
  returnPlayback: z.literal(true).optional(),
  effectiveAtMs: z.number().int().nonnegative().optional(),
};

export const playbackWriteResult = z.object({
  applied: z.boolean(),
  playback: playbackStateSchema.optional(),
  historical: z.literal(true).optional(),
});

export async function readPlaybackTab(owner: string) {
  const tab = getCurrentRequestBrowserTabId();
  if (!tab)
    return scenarioErrors.fail(
      "Open the café in the current browser tab to use playback.",
      "invalid_scenario",
      { statusCode: 400 },
    );
  const navKey = appStateKeyForBrowserTab("navigation", tab);
  const stateKey = appStateKeyForBrowserTab("cafe-playback", tab);
  const values = await appStateGetMany(owner, [navKey, stateKey]);
  return {
    tab,
    navKey,
    stateKey,
    navigation: values[navKey],
    stored: values[stateKey] ?? null,
  };
}

export async function updatePlayback(
  owner: string,
  identity: PlaybackIdentity,
  change: PlaybackChange,
  {
    observedSeekId,
    observedClockRevision,
    returnPlayback,
    initialize,
    effectiveAtMs,
  }: {
    observedSeekId?: string | null | undefined;
    observedClockRevision?: number | undefined;
    returnPlayback?: true | undefined;
    initialize?: true | undefined;
    effectiveAtMs?: number | undefined;
  },
) {
  const { tab, navKey, stateKey, navigation, stored } =
    await readPlaybackTab(owner);
  const browser = observedSeekId !== undefined;
  if (
    navigation?.view !== "cafe" ||
    navigation.scenarioId !== identity.scenarioId ||
    navigation.comparisonScenarioId !== identity.comparisonScenarioId ||
    (!browser && navigation.document !== "service-test")
  )
    return scenarioErrors.fail(
      "Open the selected Saturday result in Service test before changing playback.",
      "scenario_conflict",
      { statusCode: 409 },
    );
  const bounds = await currentPlaybackBounds(owner, identity);
  if (!bounds)
    return scenarioErrors.fail(
      "The selected Saturday has changed. Read the current screen before changing playback.",
      "invalid_scenario",
      { statusCode: 409 },
    );
  if ("at" in change && (change.at < bounds.start || change.at > bounds.end))
    return scenarioErrors.fail(
      "Choose a time within the selected Saturday playback.",
      "invalid_scenario",
      { statusCode: 400 },
    );
  const parsed = playbackStateSchema.safeParse(stored);
  const saved = parsed.success ? parsed.data : null;
  const epoch = saved?.seekId ?? null;
  if (
    browser &&
    (observedSeekId !== epoch ||
      (observedClockRevision !== undefined &&
        observedClockRevision !== (saved?.clockRevision ?? 0)))
  )
    return { applied: false };
  const now = Date.now();
  const effectiveTime =
    browser && effectiveAtMs !== undefined && effectiveAtMs >= now - 10_000
      ? Math.min(now, effectiveAtMs)
      : now;
  const { state: current, exact } = restorePlayback(
    identity,
    saved,
    bounds,
    now,
  );
  const next = initialize
    ? current
    : changePlayback(current, change, bounds, effectiveTime);
  const result = (playback: PlaybackState) => ({
    applied: true,
    ...(returnPlayback ? { playback } : {}),
    ...(identity.historical ? { historical: true as const } : {}),
  });
  if (browser && exact && current === next) return result(current);
  const updated = {
    ...next,
    ...(!browser
      ? { seekId: crypto.randomUUID(), commandedAtMs: now }
      : epoch
        ? { seekId: epoch }
        : {}),
    ...(!browser || returnPlayback || saved?.clockRevision !== undefined
      ? { clockRevision: (saved?.clockRevision ?? 0) + 1 }
      : {}),
  };
  const applied = await appStateCompareAndSetMany(
    owner,
    [
      { key: navKey, expectedValue: navigation, nextValue: navigation },
      { key: stateKey, expectedValue: stored, nextValue: updated },
    ],
    { requestSource: browser ? tab : "agent" },
  );
  if (applied) return result(updated);
  if (browser) return { applied: false };
  return scenarioErrors.fail(
    "The screen or timeline moved. Read the current screen and retry.",
    "scenario_conflict",
    { statusCode: 409 },
  );
}
