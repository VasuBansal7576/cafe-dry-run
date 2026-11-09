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

export function soloRunId(scenario: Revision, settings: Settings): string {
  return runId([
    1,
    scenario.id,
    scenario.revision,
    settings.seed,
    settings.demandLevel,
    settings.runCount,
  ]);
}

export function pairedRunId(
  scenario: Revision,
  arrivalSource: Revision,
  settings: Settings,
): string {
  return runId([
    `paired-v${pairedRunVersion}`,
    scenario.id,
    scenario.revision,
    arrivalSource.id,
    arrivalSource.revision,
    settings.seed,
    settings.runCount,
    settings.demandLevel,
  ]);
}
