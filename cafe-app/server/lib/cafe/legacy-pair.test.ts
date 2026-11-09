import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import getComparison from "../../../actions/get-comparison.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import { getDb } from "../../db/index.js";
import { decisionRuns, scenarios, serviceRuns } from "../../db/schema.js";
import migrate from "../../plugins/db.js";
import {
  compareScenarios,
  computeRunway,
  configureShop,
  setDemand,
} from "./full-action-fixtures.js";
import { illustrative } from "./provenance.js";

const defaults = vi.hoisted(() => ({ changed: false }));
vi.mock(import("./scenario.js"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    defaultDemand(base: number) {
      const demand = original.defaultDemand(base);
      if (defaults.changed) demand.hourlyMultipliers.fill(illustrative(2));
      return demand;
    },
    defaultShop() {
      const shop = original.defaultShop();
      if (defaults.changed) shop.patienceSeconds = illustrative(600);
      return shop;
    },
  };
});

const owner = {
  caller: "tool",
  userEmail: "legacy-pair@example.invalid",
} satisfies ActionRunContext;
const outsider = { ...owner, userEmail: "outside-pair@example.invalid" };
const ids = Array.from(
  { length: 7 },
  (_, index) => `00000000-0000-4000-a000-00000000000${index + 1}`,
);
const [ancestor, aId, bId, v1Source, v1Alternative, v2Source, v2Alternative] =
  ids as [string, string, string, string, string, string, string];
const version = (id: string) => ({
  id,
  expectedRevision: 7,
  expectedFinanceRevision: 0,
});
const settings = { seed: 5, demandLevel: "base" as const, runCount: 1 };

beforeAll(async () => {
  await getDbExec().execute(`CREATE TABLE cafe_scenarios (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    base_hourly_demand INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0
  )`);
  for (const id of ids) {
    await getDbExec().execute({
      sql: "INSERT INTO cafe_scenarios VALUES (?, ?, 20, 7)",
      args: [id, owner.userEmail],
    });
  }
  await migrate({});
  for (const id of [aId, bId]) {
    await getDb()
      .update(scenarios)
      .set({ parentId: ancestor })
      .where(eq(scenarios.id, id));
  }
});

beforeEach(() => {
  defaults.changed = false;
});

afterAll(closeDbExec);

it("freezes effective inputs for both legacy sides and their separate shared source", async () => {
  const input = { a: version(aId), b: version(bId), ...settings };
  const reversedInput = { ...input, a: input.b, b: input.a };
  const [before, beforeReversed] = await Promise.all([
    compareScenarios.run(input, owner),
    compareScenarios.run(reversedInput, owner),
  ]);
  expect(beforeReversed.receipt.b?.service.id).toBe(
    before.receipt.a.service.id,
  );
  const beforePlayback = await getSimulation.run(
    { id: aId, runId: before.receipt.a.service.id, includePlayback: true },
    owner,
  );

  defaults.changed = true;
  const [after, reversed] = await Promise.all([
    compareScenarios.run(input, owner),
    compareScenarios.run(reversedInput, owner),
  ]);
  const afterPlayback = await getSimulation.run(
    { id: aId, runId: after.receipt.a.service.id, includePlayback: true },
    owner,
  );

  expect(after.receipt.weekend.base.arrivals).toBe(
    afterPlayback.run?.playback?.arrivals.length,
  );
  expect(afterPlayback).toEqual(beforePlayback);
  expect(reversed.receipt.b?.service.id).toBe(after.receipt.a.service.id);
  expect(reversed.receipt.weekend.base.arrivalDigest).toBe(
    after.receipt.weekend.base.arrivalDigest,
  );
  expect(after.receipt.cashBaseline?.id).toBe(ancestor);
  const { scenarios: current } = await listScenarios.run({}, owner);
  for (const id of [ancestor, aId, bId]) {
    expect(current.find((scenario) => scenario.id === id)).toMatchObject({
      revision: 7,
      shop: { patienceSeconds: { value: 300 } },
    });
    expect(
      current.find((scenario) => scenario.id === id)?.demand
        .hourlyMultipliers[0]?.value,
    ).not.toBe(2);
  }
  expect((await getComparison.run({ aId, bId }, owner)).decision).toEqual(
    after,
  );
  await expect(compareScenarios.run(input, outsider)).rejects.toThrow();
  expect(await getComparison.run({ aId, bId }, outsider)).toEqual({
    arrivalSource: null,
    decision: null,
  });
});

it.each([
  ["paired-v1", v1Source, v1Alternative],
  ["paired-v2", v2Source, v2Alternative],
])(
  "keeps %s receipts and both runs readable as stale after materialization",
  async (namespace, sourceId, alternativeId) => {
    const savedCustomers = { enabled: true, tag: "observed" as const };
    const input = {
      a: version(sourceId),
      b: version(alternativeId),
      ...settings,
    };
    const historical = await compareScenarios.run(
      { ...input, savedCustomers },
      owner,
    );
    const receipt = historical.receipt;
    for (const { service } of [receipt.a, receipt.b!]) {
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            namespace,
            service.scenarioId,
            7,
            sourceId,
            7,
            settings.seed,
            settings.runCount,
            settings.demandLevel,
          ]),
        )
        .digest("hex");
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      await getDb()
        .update(serviceRuns)
        .set({ id })
        .where(eq(serviceRuns.id, service.id));
      service.id = id;
    }
    Reflect.deleteProperty(receipt, "pairedRunVersion");
    await getDb()
      .update(decisionRuns)
      .set({ receipt })
      .where(eq(decisionRuns.id, receipt.id));

    const solo = await runSimulation.run(
      { ...version(sourceId), ...settings },
      owner,
    );
    const readHistorical = () =>
      getComparison.run(
        { aId: sourceId, bId: alternativeId, receiptId: receipt.id },
        owner,
      );
    expect((await readHistorical()).decision).toMatchObject({
      receipt,
      serviceStale: true,
      cashStale: true,
      currentSavedCustomers: savedCustomers,
    });
    for (const { service } of [receipt.a, receipt.b!]) {
      const params = {
        id: service.scenarioId,
        runId: service.id,
        includePlayback: true,
      };
      const { run } = await getSimulation.run(params, owner);
      expect(run).toMatchObject({
        stale: true,
        arrivalSource: { id: sourceId, revision: 7 },
        summary: service.summary,
        playback: { arrivals: expect.any(Array) },
      });
      await expect(getSimulation.run(params, outsider)).rejects.toThrow();
    }
    expect(
      (await getSimulation.run({ id: sourceId }, owner)).run,
    ).toMatchObject({
      id: solo.id,
      stale: false,
    });

    const latest = await compareScenarios.run(input, owner);
    expect(latest).toMatchObject({
      serviceStale: false,
      cashStale: false,
      receipt: {
        savedCustomers,
        assumptionRevision: receipt.assumptionRevision,
      },
    });
    expect(latest.receipt.a.service.id).not.toBe(receipt.a.service.id);
    expect(latest.receipt.b?.service.id).not.toBe(receipt.b?.service.id);
    expect((await readHistorical()).decision).toMatchObject({
      receipt,
      historical: true,
      serviceStale: true,
      cashStale: true,
    });
  },
);

it("separates the counted total and sample source when reading and refreshing earlier receipts", async () => {
  const { scenario } = await createScenario.run(
    { label: "Counted shop" },
    owner,
  );
  const { scenario: a } = await setDemand.run(
    {
      id: scenario.id,
      expectedRevision: scenario.revision,
      demand: {
        pedestrian: {
          count: { value: 120, source: { tag: "observed" } },
          conversionPercent: { value: 10, source: { tag: "estimate" } },
        },
      },
    },
    owner,
  );
  const versionOf = ({ id, revision, financeRevision }: typeof a) => ({
    id,
    expectedRevision: revision,
    expectedFinanceRevision: financeRevision,
  });
  const { scenario: b } = await configureShop.run(
    {
      ...versionOf(a),
      variantLabel: "Earlier alternative",
    },
    owner,
  );
  const pair = { a: versionOf(a), b: versionOf(b) };
  const { receipt } = await compareScenarios.run(
    { ...pair, ...settings },
    owner,
  );
  const legacy = structuredClone(receipt);
  for (const side of [legacy.a, legacy.b!]) {
    delete side.service.summary.arrivalProvenance;
    await getDb()
      .update(serviceRuns)
      .set({ summary: side.service.summary })
      .where(eq(serviceRuns.id, side.service.id));
  }
  for (const demand of Object.values(legacy.weekendDemand))
    demand.tag = "illustrative";
  await getDb()
    .update(decisionRuns)
    .set({ receipt: legacy })
    .where(eq(decisionRuns.id, legacy.id));

  const scope = { aId: a.id, bId: b.id, receiptId: legacy.id };
  const earlier = (await getComparison.run(scope, owner)).decision;
  expect(earlier?.receipt.weekendDemand.base).toEqual({
    value: 12,
    tag: "estimate",
  });
  expect(earlier?.receipt.a.service.summary.arrivalProvenance).toBe(
    "illustrative",
  );
  const readRun = () =>
    getSimulation.run({ id: a.id, runId: receipt.a.service.id }, owner);
  expect((await readRun()).run?.summary.arrivalProvenance).toBe("illustrative");

  const refreshed = await computeRunway.run(
    { comparison: { ...pair, receiptId: legacy.id } },
    owner,
  );
  expect(refreshed.receipt.a.service.id).toBe(legacy.a.service.id);
  expect(refreshed.receipt.b?.service.id).toBe(legacy.b?.service.id);
  expect(refreshed.receipt.a.service.summary.arrivalProvenance).toBe(
    "illustrative",
  );
  expect(refreshed.receipt.weekendDemand.base.tag).toBe("estimate");

  await setDemand.run(
    { id: a.id, expectedRevision: a.revision, baseHourlyDemand: 20 },
    owner,
  );
  const { run } = await readRun();
  expect(run?.stale).toBe(true);
  expect(run?.summary.arrivalProvenance).toBeUndefined();
  expect(
    (await getComparison.run(scope, owner)).decision?.receipt.a.service.summary
      .arrivalProvenance,
  ).toBe("illustrative");
});
