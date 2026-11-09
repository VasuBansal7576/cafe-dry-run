import type { ActionRunContext } from "@agent-native/core/action";
import { appStateGet, appStatePut } from "@agent-native/core/application-state";
import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import compareScenarios from "../../../actions/compare-scenarios.js";
import computeRunway from "../../../actions/compute-runway.js";
import createScenario from "../../../actions/create-scenario.js";
import getSimulation from "../../../actions/get-simulation.js";
import runSimulation from "../../../actions/run-simulation.js";
import setDemand from "../../../actions/set-demand.js";
import seek from "../../../actions/set-playback-position.js";
import viewScreen from "../../../actions/view-screen.js";
import { playbackBounds } from "../../../shared/cafe/playback-position.js";
import migrate from "../../plugins/db.js";

const owner = {
  caller: "tool",
  userEmail: "playback@example.invalid",
} satisfies ActionRunContext;
const other = {
  caller: "tool",
  userEmail: "other@example.invalid",
} satisfies ActionRunContext;
const settings = { seed: 42, runCount: 1, demandLevel: "base" } as const;
const version = ({
  id,
  revision,
  financeRevision,
}: {
  id: string;
  revision: number;
  financeRevision: number;
}) => ({
  id,
  expectedRevision: revision,
  expectedFinanceRevision: financeRevision,
});

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

function inTab<T>(tab: string, task: () => T, actor = owner) {
  return runWithRequestContext(
    { userEmail: actor.userEmail, run: { browserTabId: tab } },
    task,
  );
}

async function select(
  tab: string,
  scenarioId: string,
  comparisonScenarioId?: string,
  actor = owner,
) {
  await appStatePut(actor.userEmail, `navigation:${tab}`, {
    view: "cafe",
    document: "service-test",
    scenarioId,
    ...(comparisonScenarioId ? { comparisonScenarioId } : {}),
  });
}

it("shares the solo position per tab and keeps a late browser update from undoing an agent seek", async () => {
  const { scenario } = await createScenario.run(
    { baseHourlyDemand: 40 },
    owner,
  );
  const args = {
    ...settings,
    id: scenario.id,
    expectedRevision: scenario.revision,
  };
  const run = await runSimulation.run(args, owner);
  const identity = { scenarioId: scenario.id, runId: run.id };
  await select("a", scenario.id);
  await select("b", scenario.id);
  const input = { ...identity, at: 28801, observedSeekId: null };
  expect(await inTab("a", () => seek.run(input, owner))).toEqual({
    applied: true,
  });
  expect(await appStateGet(owner.userEmail, "cafe-playback:a")).toEqual({
    ...identity,
    second: 28801,
  });
  expect(await appStateGet(owner.userEmail, "cafe-playback:b")).toBeNull();
  expect(
    await inTab("a", () => seek.run({ ...identity, at: "10:00" }, owner)),
  ).toEqual({ applied: true });
  expect(await inTab("a", () => seek.run(input, owner))).toEqual({
    applied: false,
  });
  expect(await inTab("a", () => viewScreen.run({}, owner))).toMatchObject({
    playback: { ...identity, second: 36000 },
  });
  const stored = await appStateGet(owner.userEmail, "cafe-playback:a");
  expect(stored?.seekId).toEqual(expect.any(String));
  await expect(
    inTab("a", () => seek.run({ ...identity, at: 28799 }, owner)),
  ).rejects.toMatchObject({ statusCode: 400 });
  await select("a", scenario.id, undefined, other);
  await expect(
    inTab("a", () => seek.run({ ...identity, at: 36000 }, other), other),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await appStateGet(other.userEmail, "cafe-playback:a")).toBeNull();
  expect(await appStateGet(owner.userEmail, "cafe-playback:a")).toEqual(stored);

  const next = await runSimulation.run({ ...args, seed: 43 }, owner);
  expect(next.id).not.toEqual(run.id);
  await expect(
    inTab("a", () => seek.run({ ...identity, at: 36000 }, owner)),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await inTab("a", () => viewScreen.run({}, owner))).toMatchObject({
    playbackStatus: "unavailable",
  });
});

it("accepts only the latest ordered pair and inclusive late-event bounds", async () => {
  const { scenario: a } = await createScenario.run(
    { baseHourlyDemand: 80 },
    owner,
  );
  const { scenario: b } = await createScenario.run(
    { baseHourlyDemand: 80 },
    owner,
  );
  const compared = await compareScenarios.run(
    { ...settings, a: version(a), b: version(b) },
    owner,
  );
  const { receipt } = compared;
  if (!("a" in receipt)) throw new Error("Expected a full comparison receipt");
  const first = receipt.a.service.id;
  const second = receipt.b!.service.id;
  const identity = {
    scenarioId: a.id,
    runId: first,
    comparisonScenarioId: b.id,
    comparisonRunId: second,
    receiptId: receipt.id,
  };
  const [firstRead, secondRead] = await Promise.all([
    getSimulation.run({ id: a.id, runId: first, includePlayback: true }, owner),
    getSimulation.run(
      { id: b.id, runId: second, includePlayback: true },
      owner,
    ),
  ]);
  const { start, end } = playbackBounds(
    firstRead.run!.summary.hours,
    [firstRead, secondRead].map(({ run }) => {
      const timeline = run!.playback!.timeline;
      return timeline[timeline.length - 1]?.at ?? 0;
    }),
  );
  expect(end).toBeGreaterThan(firstRead.run!.summary.hours.closesAt);
  await select("pair", a.id, b.id);
  for (const at of [start, end]) {
    expect(
      await inTab("pair", () => seek.run({ ...identity, at }, owner)),
    ).toEqual({ applied: true });
  }
  for (const at of [start - 1, end + 1]) {
    await expect(
      inTab("pair", () => seek.run({ ...identity, at }, owner)),
    ).rejects.toMatchObject({ statusCode: 400 });
  }
  await expect(
    inTab("pair", () =>
      seek.run({ ...identity, comparisonRunId: first, at: end }, owner),
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  const cash = await computeRunway.run(
    {
      comparison: {
        a: version(a),
        b: version(b),
        receiptId: receipt.id,
        savedCustomers: { enabled: true, tag: "estimate" },
      },
    },
    owner,
  );
  if (!("a" in cash.receipt)) throw new Error("Expected a full cash receipt");
  expect(cash.receipt.a.service.id).toBe(first);
  expect(cash.receipt.b?.service.id).toBe(second);
  await expect(
    inTab("pair", () => seek.run({ ...identity, at: end }, owner)),
  ).rejects.toMatchObject({ statusCode: 409 });
  const refreshed = { ...identity, receiptId: cash.receipt.id };
  expect(
    await inTab("pair", () => seek.run({ ...refreshed, at: end }, owner)),
  ).toEqual({ applied: true });
  await setDemand.run(
    { id: a.id, expectedRevision: a.revision, baseHourlyDemand: 81 },
    owner,
  );
  await expect(
    inTab("pair", () => seek.run({ ...refreshed, at: end }, owner)),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await inTab("pair", () => viewScreen.run({}, owner))).toMatchObject({
    playbackStatus: "unavailable",
  });
  expect(
    await appStateGet(owner.userEmail, "cafe-playback:pair"),
  ).toMatchObject({ ...refreshed, second: end });
});
