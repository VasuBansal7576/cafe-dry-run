import { setTimeout as delay } from "node:timers/promises";

import type { ActionRunContext } from "@agent-native/core/action";
import { appStateGet, appStatePut } from "@agent-native/core/application-state";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import compareScenarios from "../../../actions/compare-scenarios.js";
import computeRunway from "../../../actions/compute-runway.js";
import createScenario from "../../../actions/create-scenario.js";
import getPlaybackClock from "../../../actions/get-playback-clock.js";
import getSimulation from "../../../actions/get-simulation.js";
import runSimulation from "../../../actions/run-simulation.js";
import setDemand from "../../../actions/set-demand.js";
import controls from "../../../actions/set-playback-controls.js";
import seek from "../../../actions/set-playback-position.js";
import viewScreen from "../../../actions/view-screen.js";
import {
  calibratePlaybackClock,
  changePlayback,
  playbackBounds,
  precisePlaybackClock,
  updateRunningPlaybackPreview,
} from "../../../shared/cafe/playback-position.js";
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

it("keeps a reliable playhead calibration when a clock response is held in transit", () => {
  const initial = calibratePlaybackClock(undefined, 100, 120, 5_110);
  expect(initial).toEqual({
    offset: 5_000.5,
    earliestOffset: 4_990,
    latestOffset: 5_011,
  });
  expect(calibratePlaybackClock(initial, 200, 2_060, 5_210)).toEqual(initial);
  expect(calibratePlaybackClock(initial, 200, 2_060, 7_050)).toEqual(initial);
  expect(calibratePlaybackClock(initial, 300, 330, 5_305)).toEqual({
    offset: 4_998,
    earliestOffset: 4_990,
    latestOffset: 5_006,
  });
});

it("uses healthy slower reads and narrows the estimate when latency switches directions", () => {
  expect(calibratePlaybackClock(undefined, 100, 435, 5_267)).toEqual({
    offset: 5_000,
    earliestOffset: 4_832,
    latestOffset: 5_168,
  });
  const requestDelayed = calibratePlaybackClock(undefined, 100, 1_000, 5_995);
  expect(requestDelayed).toEqual({
    offset: 5_445.5,
    earliestOffset: 4_995,
    latestOffset: 5_896,
  });
  expect(precisePlaybackClock(requestDelayed)).toBe(false);
  const refined = calibratePlaybackClock(requestDelayed, 1_100, 2_000, 6_105);
  expect(precisePlaybackClock(refined)).toBe(true);
  expect(refined).toEqual({
    offset: 5_000.5,
    earliestOffset: 4_995,
    latestOffset: 5_006,
  });
});

it("a contradictory timestamp cannot replace trusted timing or claim precision by itself", () => {
  const trusted = calibratePlaybackClock(undefined, 100, 120, 5_110);
  const contradicted = calibratePlaybackClock(trusted, 200, 220, 8_210);
  expect(contradicted.offset).toBe(trusted.offset);
  expect(precisePlaybackClock(contradicted)).toBe(false);
  const recovered = calibratePlaybackClock(contradicted, 300, 320, 5_310);
  expect(recovered.offset).toBe(trusted.offset);
  expect(precisePlaybackClock(recovered)).toBe(true);
  const corroborated = calibratePlaybackClock(contradicted, 400, 420, 8_410);
  expect(corroborated.offset).toBe(8_000.5);
  expect(precisePlaybackClock(corroborated)).toBe(true);
});

it("holds the displayed frame during recalibration and releases it for a different anchor", () => {
  const anchor = {
    scenarioId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    startedAtMs: 5_000,
    second: 30_000,
    speed: 600 as const,
  };
  const approximate = updateRunningPlaybackPreview(null, anchor, 5_420, 1_000);
  const refined = updateRunningPlaybackPreview(
    approximate,
    anchor,
    5_000,
    1_050,
  );
  expect(refined?.holdThrough).toBe(6_470);
  const repeatedPlay = {
    ...anchor,
    seekId: crypto.randomUUID(),
    clockRevision: 2,
  };
  expect(
    updateRunningPlaybackPreview(refined, repeatedPlay, 5_000, 1_200),
  ).toBe(refined);
  expect(
    updateRunningPlaybackPreview(
      refined,
      { ...anchor, second: 29_500 },
      5_000,
      1_220,
    )?.holdThrough,
  ).toBe(0);
  expect(
    updateRunningPlaybackPreview(
      refined,
      { scenarioId: anchor.scenarioId, runId: anchor.runId, second: 29_000 },
      5_000,
      1_230,
    ),
  ).toBeNull();
});

it("an explicit pause settles a running anchor that has already reached the end", () => {
  const anchor = {
    scenarioId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    second: 36_000,
    startedAtMs: 2_000,
  };
  expect(
    changePlayback(
      anchor,
      { playing: false },
      { start: 30_000, end: 36_100 },
      3_000,
    ),
  ).toEqual({
    scenarioId: anchor.scenarioId,
    runId: anchor.runId,
    second: 36_100,
  });
});

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
    playback: { ...identity, second: 36000, playing: false, speed: 120 },
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
  await expect(
    inTab("pair", () => controls.run({ ...refreshed, playing: true }, owner)),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    await inTab("pair", () =>
      controls.run({ ...refreshed, historical: true, speed: 30 }, owner),
    ),
  ).toMatchObject({ applied: true, historical: true });
  expect(await inTab("pair", () => viewScreen.run({}, owner))).toMatchObject({
    playbackStatus: "stale",
    playback: {
      ...refreshed,
      historical: true,
      second: end,
      playing: false,
      speed: 30,
    },
  });
  await expect(
    inTab("pair", () =>
      seek.run({ ...refreshed, historical: true, at: end + 1 }, owner),
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  await select("pair", a.id, b.id, other);
  await expect(
    inTab(
      "pair",
      () =>
        controls.run({ ...refreshed, historical: true, playing: true }, other),
      other,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
});

it("plays and pauses a legacy clock using the same actions and preserves its position across speed changes", async () => {
  const { scenario } = await createScenario.run(
    { baseHourlyDemand: 40 },
    owner,
  );
  const run = await runSimulation.run(
    { ...settings, id: scenario.id, expectedRevision: scenario.revision },
    owner,
  );
  const identity = { scenarioId: scenario.id, runId: run.id };
  const tab = "clock";
  const key = `cafe-playback:${tab}`;
  await select(tab, scenario.id);
  const legacy = { ...identity, second: 30000 };
  await appStatePut(owner.userEmail, key, legacy);
  const screen = () => inTab(tab, () => viewScreen.run({}, owner));
  const set = (
    input: Omit<Parameters<typeof controls.run>[0], keyof typeof identity>,
  ) => inTab(tab, () => controls.run({ ...identity, ...input }, owner));
  const savedAt = async () =>
    (
      await getDbExec().execute({
        sql: "SELECT updated_at FROM application_state WHERE session_id = ? AND key = ?",
        args: [owner.userEmail, key],
      })
    ).rows[0]?.updated_at;

  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    expect(await screen()).toMatchObject({
      playback: { ...legacy, speed: 120, playing: false },
    });
    expect(await set({ playing: true })).toMatchObject({ applied: true });
    const started = await appStateGet(owner.userEmail, key);
    const startedWrite = await savedAt();
    expect(started).toMatchObject({ ...legacy, startedAtMs: now });

    clock.mockReturnValue(now + 1000);
    expect(await screen()).toMatchObject({
      playback: { second: 30120, speed: 120, playing: true },
    });
    expect(await appStateGet(owner.userEmail, key)).toEqual(started);
    expect(await savedAt()).toBe(startedWrite);
    expect(await set({ playing: true })).toMatchObject({ applied: true });
    const replayed = await appStateGet(owner.userEmail, key);
    expect(replayed).toMatchObject({
      ...legacy,
      startedAtMs: now,
      commandedAtMs: now + 1000,
    });
    expect(replayed?.seekId).not.toBe(started?.seekId);
    expect(
      await set({ playing: false, observedSeekId: started!.seekId as string }),
    ).toEqual({ applied: false });
    const seekId = replayed!.seekId as string;
    expect(
      await set({
        speed: 600,
        observedSeekId: seekId,
        observedClockRevision: 2,
        returnPlayback: true,
      }),
    ).toMatchObject({
      applied: true,
      playback: {
        second: 30120,
        speed: 600,
        startedAtMs: now + 1000,
        clockRevision: 3,
      },
    });

    clock.mockReturnValue(now + 1500);
    expect(await screen()).toMatchObject({
      playback: { second: 30420, speed: 600, playing: true },
    });
    clock.mockReturnValue(now + 2000);
    expect(
      await set({
        playing: false,
        effectiveAtMs: now + 1500,
        observedSeekId: seekId,
        observedClockRevision: 3,
      }),
    ).toMatchObject({ applied: true });
    const paused = await appStateGet(owner.userEmail, key);
    const pausedWrite = await savedAt();
    expect(paused).not.toHaveProperty("startedAtMs");
    expect(
      await set({
        speed: 30,
        observedSeekId: seekId,
        observedClockRevision: 3,
      }),
    ).toEqual({ applied: false });
    clock.mockReturnValue(now + 9000);
    expect(await screen()).toMatchObject({
      playback: { second: 30420, speed: 600, playing: false },
    });
    expect(
      await set({
        playing: false,
        speed: 600,
        observedSeekId: seekId,
        observedClockRevision: 4,
      }),
    ).toMatchObject({
      applied: true,
    });
    expect(await appStateGet(owner.userEmail, key)).toEqual(paused);
    expect(await savedAt()).toBe(pausedWrite);
    expect(
      await inTab(tab, () => getPlaybackClock.run({}, owner)),
    ).toMatchObject({
      selection: { view: "cafe", scenarioId: scenario.id },
      playback: { ...legacy, second: 30420, speed: 600, clockRevision: 4 },
      sampledAtMs: now + 9000,
    });
  } finally {
    clock.mockRestore();
  }
});

it("advances a real running clock without writes and rejects stale commands after a concurrent agent pause", async () => {
  const { scenario } = await createScenario.run(
    { baseHourlyDemand: 40 },
    owner,
  );
  const run = await runSimulation.run(
    { ...settings, id: scenario.id, expectedRevision: scenario.revision },
    owner,
  );
  const identity = { scenarioId: scenario.id, runId: run.id };
  const tab = "real-clock";
  const key = `cafe-playback:${tab}`;
  await select(tab, scenario.id);
  await inTab(tab, () => seek.run({ ...identity, at: 30000 }, owner));
  await inTab(tab, () =>
    controls.run({ ...identity, speed: 600, playing: true }, owner),
  );
  const before = await appStateGet(owner.userEmail, key);
  await delay(180);
  const read = await inTab(tab, () => viewScreen.run({}, owner));
  expect(read).toMatchObject({ playback: { playing: true, speed: 600 } });
  if (typeof read === "string") throw new Error("Expected a playback frame");
  expect((read.playback as { second: number }).second).toBeGreaterThanOrEqual(
    30090,
  );
  expect(await appStateGet(owner.userEmail, key)).toEqual(before);

  const observedSeekId = before!.seekId as string;
  const pause = () =>
    inTab(tab, () => controls.run({ ...identity, playing: false }, owner));
  const lateBrowserEdit = () =>
    inTab(tab, () =>
      seek.run({ ...identity, observedSeekId, at: 32000 }, owner),
    );
  const [agent] = await Promise.allSettled([pause(), lateBrowserEdit()]);
  if (agent.status === "rejected") {
    expect(agent.reason).toMatchObject({ statusCode: 409 });
    await pause();
  } else {
    expect(agent.value).toMatchObject({ applied: true });
  }
  expect(await lateBrowserEdit()).toEqual({ applied: false });
  expect(await inTab(tab, () => viewScreen.run({}, owner))).toMatchObject({
    playback: { playing: false },
  });
  expect(
    await appStateGet(owner.userEmail, "cafe-playback:other-real-clock"),
  ).toBeNull();
});
