import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import compareScenarios from "../../../actions/compare-scenarios.js";
import configureShop from "../../../actions/configure-shop.js";
import createScenario from "../../../actions/create-scenario.js";
import getComparison from "../../../actions/get-comparison.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import setDemand from "../../../actions/set-demand.js";
import setSpot from "../../../actions/set-spot.js";
import migrate from "../../plugins/db.js";
import { illustrative } from "./provenance.js";
import type { Scenario } from "./scenario-store.js";

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
  userEmail: "legacy@example.invalid",
} satisfies ActionRunContext;
const id = "00000000-0000-4000-a000-000000000001";
const unrunId = "00000000-0000-4000-a000-000000000002";

beforeAll(async () => {
  await getDbExec().execute(`CREATE TABLE cafe_scenarios (
    id TEXT PRIMARY KEY, owner_email TEXT NOT NULL,
    base_hourly_demand INTEGER NOT NULL CHECK (base_hourly_demand BETWEEN 0 AND 1000),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  )`);
  await getDbExec().execute({
    sql: `INSERT INTO cafe_scenarios (id, owner_email, base_hourly_demand, revision)
          VALUES (?, ?, 28, 7), (?, ?, 28, 7)`,
    args: [id, owner.userEmail, unrunId, owner.userEmail],
  });
  await migrate({});
});

afterAll(() => closeDbExec());

it("keeps the effective inputs of a saved legacy run after defaults change", async () => {
  const {
    scenarios: [original],
  } = await listScenarios.run({}, owner);
  expect(original?.demand.hourly.base.value).toBe(28);
  const parameters = {
    id,
    expectedRevision: 7,
    seed: 42,
    demandLevel: "base" as const,
    runCount: 2,
  };
  const result = await runSimulation.run(parameters, owner);
  const saved = await getSimulation.run({ id, includePlayback: true }, owner);

  defaults.changed = true;
  const {
    scenarios: [scenario, unrun],
  } = await listScenarios.run({}, owner);
  expect(unrun?.demand.hourlyMultipliers[0]?.value).toBe(2);
  expect(unrun?.shop.patienceSeconds.value).toBe(600);
  expect(scenario).toEqual({ ...original, latestRunId: result.id });
  expect(await runSimulation.run(parameters, owner)).toEqual(result);
  expect(await getSimulation.run({ id, includePlayback: true }, owner)).toEqual(
    saved,
  );
  expect(saved.run?.stale).toBe(false);
});

const revision = (scenario: Scenario) => ({
  id: scenario.id,
  expectedRevision: scenario.revision,
  expectedFinanceRevision: scenario.financeRevision,
});

it("copies the selected spot to a new variant without changing the baseline", async () => {
  const { scenario: original } = await createScenario.run({ label: "Site baseline", baseHourlyDemand: 30 }, owner);
  const moved = await setSpot.run({ id: original.id, expectedSpotRevision: original.spotRevision, location: { placeName: "Near Indiranagar Metro" } }, owner);
  const { scenario: variant } = await configureShop.run({ ...revision(original), shop: {}, variantLabel: "Site variant" }, owner);
  expect(variant.spot).toEqual(moved.spot);
  expect(variant.spotRevision).toBe(0);
  const persisted = await listScenarios.run({}, owner);
  expect(persisted.scenarios.find((row) => row.id === original.id)?.spot).toEqual(moved.spot);
});

it("distinguishes historical assumptions and invalidates linked runs when the shared arrival scenario changes", async () => {
  const { scenario: original } = await createScenario.run(
    { label: "Original", baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: a } = await configureShop.run(
    { ...revision(original), shop: {}, variantLabel: "Cover" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...revision(original), shop: {}, variantLabel: "Grinder" },
    owner,
  );
  const input = {
    a: revision(a),
    b: revision(b),
    seed: 1,
    demandLevel: "base" as const,
    runCount: 1,
  };
  const old = await compareScenarios.run(
    { ...input, savedCustomers: { enabled: false, tag: "estimate" } },
    owner,
  );
  const latest = await compareScenarios.run(
    { ...input, savedCustomers: { enabled: true, tag: "estimate" } },
    owner,
  );
  const scope = { aId: a.id, bId: b.id };
  const historical = await getComparison.run(
    { ...scope, receiptId: old.receipt.id },
    owner,
  );
  expect(historical.decision).toMatchObject({
    cashStale: true,
    serviceStale: false,
    historical: true,
    assumptionStale: true,
    currentSavedCustomers: { enabled: true, tag: "estimate" },
    receipt: { savedCustomers: { enabled: false, tag: "estimate" } },
  });
  expect((await getComparison.run(scope, owner)).decision).toEqual(latest);
  const runId = latest.receipt.b!.service.id;
  expect(
    (
      await getSimulation.run(
        { id: b.id, runId, includePlayback: false },
        owner,
      )
    ).run,
  ).toMatchObject({
    stale: false,
    arrivalSource: { id: original.id, revision: original.revision },
  });
  await setDemand.run({ ...revision(original), baseHourlyDemand: 65 }, owner);
  expect(
    (
      await getSimulation.run(
        { id: b.id, runId, includePlayback: false },
        owner,
      )
    ).run?.stale,
  ).toBe(true);
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    serviceStale: true,
    cashStale: true,
  });
});

it("keeps one saved-customer choice across both display orders and invalidates older choices", async () => {
  const { scenario: original } = await createScenario.run(
    { label: "Reference", baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: barista } = await configureShop.run(
    {
      ...revision(original),
      variantLabel: "Barista",
      shop: {
        workers: [
          ...original.shop.workers,
          {
            id: "cover",
            name: "Cover",
            shifts: [
              {
                startsAt: illustrative(10 * 3600),
                endsAt: illustrative(12 * 3600),
              },
            ],
          },
        ],
      },
    },
    owner,
  );
  const { scenario: grinder } = await configureShop.run(
    {
      ...revision(original),
      variantLabel: "Grinder",
      shop: {
        equipment: { ...original.shop.equipment, grinder: illustrative(2) },
      },
    },
    owner,
  );
  const settings = { seed: 1, demandLevel: "base" as const, runCount: 1 };
  const forward = { a: revision(barista), b: revision(grinder), ...settings };
  const reverse = { a: forward.b, b: forward.a, ...settings };
  const forwardScope = { aId: barista.id, bId: grinder.id };
  const reverseScope = { aId: grinder.id, bId: barista.id };
  const on = { enabled: true, tag: "estimate" as const };
  const off = { enabled: false, tag: "estimate" as const };
  const first = await compareScenarios.run(
    { ...forward, savedCustomers: on },
    owner,
  );
  const swapped = await compareScenarios.run(reverse, owner);
  expect(swapped.receipt.savedCustomers).toEqual(on);
  expect(swapped.receipt.delta?.monthlyCash.value).toBe(
    -first.receipt.delta!.monthlyCash.value,
  );
  expect(swapped.receipt.weekend.base.arrivalDigest).toBe(
    first.receipt.weekend.base.arrivalDigest,
  );
  expect((await getComparison.run(forwardScope, owner)).decision).toMatchObject(
    { cashStale: false },
  );
  expect((await getComparison.run(reverseScope, owner)).decision).toMatchObject(
    { cashStale: false },
  );

  const later = await compareScenarios.run(
    { ...reverse, savedCustomers: off },
    owner,
  );
  expect((await getComparison.run(forwardScope, owner)).decision).toMatchObject(
    {
      serviceStale: false,
      cashStale: true,
      assumptionStale: true,
      currentSavedCustomers: off,
    },
  );
  await compareScenarios.run({ ...forward, savedCustomers: on }, owner);
  for (const [scope, receiptId] of [
    [forwardScope, first.receipt.id],
    [reverseScope, later.receipt.id],
  ] as const) {
    expect(
      (await getComparison.run({ ...scope, receiptId }, owner)).decision,
    ).toMatchObject({
      serviceStale: false,
      cashStale: true,
      assumptionStale: true,
      currentSavedCustomers: on,
      historical: true,
    });
  }
});

it("identifies the editable shared demand source before the first sibling comparison", async () => {
  const { scenario: original } = await createScenario.run(
    { label: "Shared original", baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: a } = await configureShop.run(
    { ...revision(original), shop: {}, variantLabel: "First variant" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...revision(original), shop: {}, variantLabel: "Second variant" },
    owner,
  );
  const scope = { aId: a.id, bId: b.id };
  expect(await getComparison.run(scope, owner)).toMatchObject({
    decision: null,
    arrivalSource: {
      id: original.id,
      revision: original.revision,
      label: original.label,
    },
  });
  const outsider = { ...owner, userEmail: "outsider@example.invalid" };
  expect(await getComparison.run(scope, outsider)).toMatchObject({
    decision: null,
    arrivalSource: null,
  });
  const compare = () =>
    compareScenarios.run(
      {
        a: revision(a),
        b: revision(b),
        seed: 1,
        demandLevel: "base",
        runCount: 1,
      },
      owner,
    );
  const first = await compare();
  const { scenario: updated } = await setDemand.run(
    { ...revision(original), baseHourlyDemand: 65 },
    owner,
  );
  expect(await getComparison.run(scope, owner)).toMatchObject({
    arrivalSource: {
      id: updated.id,
      revision: updated.revision,
      label: updated.label,
    },
    decision: { serviceStale: true, cashStale: true },
  });
  const refreshed = await compare();
  expect(refreshed.receipt.cashBaseline?.revision).toBe(updated.revision);
  expect(refreshed.receipt.weekend.base.arrivalDigest).not.toBe(
    first.receipt.weekend.base.arrivalDigest,
  );
});
