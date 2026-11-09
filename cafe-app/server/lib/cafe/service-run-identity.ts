import { createHash } from "node:crypto";

import type { ServiceRun } from "./service-run.js";

export const pairedRunVersion = 3;

type Revision = { id: string; revision: number };
type Settings = Pick<
  ServiceRun["summary"],
  "seed" | "demandLevel" | "runCount"
>;

function runId(parts: readonly (string | number)[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function soloRunKey(scenario: Revision, settings: Settings) {
  return [
    1,
    scenario.id,
    scenario.revision,
    settings.seed,
    settings.demandLevel,
    settings.runCount,
  ];
}

function pairedRunKey(
  scenario: Revision,
  arrivalSource: Revision,
  settings: Settings,
) {
  return [
    `paired-v${pairedRunVersion}`,
    scenario.id,
    scenario.revision,
    arrivalSource.id,
    arrivalSource.revision,
    settings.seed,
    settings.runCount,
    settings.demandLevel,
  ];
}

function playbackRunId(key: readonly (string | number)[]) {
  return runId([...key, "playback-v3"]);
}

function matchesPlaybackRunId(id: string, key: readonly (string | number)[]) {
  return (
    id === playbackRunId(key) ||
    id === runId([...key, "playback-v2"]) ||
    id === runId(key)
  );
}

export function soloRunId(scenario: Revision, settings: Settings) {
  return playbackRunId(soloRunKey(scenario, settings));
}

export function pairedRunId(
  scenario: Revision,
  arrivalSource: Revision,
  settings: Settings,
) {
  return playbackRunId(pairedRunKey(scenario, arrivalSource, settings));
}

export function matchesSoloRunId(
  id: string,
  scenario: Revision,
  settings: Settings,
) {
  return matchesPlaybackRunId(id, soloRunKey(scenario, settings));
}

export function matchesPairedRunId(
  id: string,
  scenario: Revision,
  arrivalSource: Revision,
  settings: Settings,
) {
  return matchesPlaybackRunId(
    id,
    pairedRunKey(scenario, arrivalSource, settings),
  );
}
