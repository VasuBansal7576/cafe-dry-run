import { actionCallIntent } from "@agent-native/core/action";
import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, test } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import getComparison from "../../../actions/get-comparison.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import tagSourceAction from "../../../actions/tag-source.js";
import migrate from "../../plugins/db.js";
import {
  computeRunway,
  configureFinance,
  setPedestrianCount,
  tagSource,
} from "./full-action-fixtures.js";

const founder = {
  caller: "frontend",
  userEmail: "founder@example.test",
} as const;
const agent = { ...founder, caller: "tool" } as const;
const other = { ...agent, userEmail: "other@example.test" };
const estimate = { tag: "estimate" } as const;
const observed = { tag: "observed" } as const;
const publicSource = {
  tag: "public",
  url: "https://example.test/price-list",
  retrievedAt: "2026-11-09",
  supportingValue: "Espresso ₹125",
} as const;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toBe("pglite:memory");
  await withMigrationRuntime(async () => await migrate(null));
});
afterAll(closeDbExec);

test("the action retags nested demand, shop and finance values without rewriting their amounts", async () => {
  const { scenario: initial } = await createScenario.run({}, founder);
  const { scenario: withFootfall } = await setPedestrianCount.run(
    {
      id: initial.id,
      expectedRevision: initial.revision,
      pedestrian: {
        count: { value: 600, source: observed },
        conversionPercent: { value: 20, source: estimate },
      },
    },
    founder,
  );
  const { scenario: before } = await configureFinance.run(
    {
      id: initial.id,
      expectedFinanceRevision: initial.financeRevision,
      finance: { equipmentAdditions: [{ value: 30000, source: estimate }] },
    },
    founder,
  );

  const cases = [
    ["demand", "hourly.low", 10, observed],
    ["demand", "hourly.base", 20, observed],
    ["demand", "hourly.high", 40, observed],
    ["demand", "opensAt", 28800, observed],
    ["demand", "closesAt", 50400, observed],
    ["demand", "hourlyMultipliers.0", 1, observed],
    ["demand", "pedestrian.count", 600, observed],
    ["demand", "pedestrian.conversionPercent", 20, observed],
    ["shop", "workers.0.shifts.0.startsAt", 28800, observed],
    ["shop", "workers.0.shifts.0.endsAt", 50400, observed],
    ["shop", "equipment.grinder", 1, observed],
    ["shop", "equipment.groupHead", 1, observed],
    ["shop", "equipment.steamWand", 1, observed],
    ["shop", "menu.0.weight", 30, observed],
    ["shop", "menu.0.tasks.2.staffSeconds", 15, observed],
    ["shop", "menu.0.tasks.2.unattendedSeconds", 25, observed],
    ["shop", "menu.0.economics.price", 125, publicSource],
    ["shop", "menu.0.economics.ingredientCost", 34, observed],
    ["shop", "patienceSeconds", 300, observed],
    ["finance", "cash", 400000, observed],
    ["finance", "rent", 45000, observed],
    ["finance", "otherRecurring", 22000, observed],
    ["finance", "fitOut", 175000, observed],
    ["finance", "equipmentUpfront", 75000, observed],
    ["finance", "equipmentAdditions.0", 30000, observed],
    ["finance", "averagePrice", 160, observed],
    ["finance", "averageIngredientCost", 55, observed],
    ["finance", "hourlyWage", 150, observed],
    ["finance", "weekdayStaffCount", 1, observed],
    ["finance", "weekdayHoursPerWorker", 6, observed],
    ["finance", "weekdaysPerMonth", 22, observed],
    ["finance", "weekendsPerMonth", 8, observed],
    ["finance", "weekdayDemand.low", 45, observed],
    ["finance", "weekdayDemand.base", 70, observed],
    ["finance", "weekdayDemand.high", 100, observed],
    ["finance", "weekdayLossPercent", 0, observed],
  ] as const;
  let scenario = before;
  for (const [section, path, value, source] of cases) {
    const result = await tagSource.run(
      section === "finance"
        ? {
            id: initial.id,
            section,
            path,
            source,
            expectedFinanceRevision: scenario.financeRevision,
          }
        : {
            id: initial.id,
            section,
            path,
            source,
            expectedRevision: scenario.revision,
          },
      agent,
    );
    const next = result.scenario;
    expect(next[section], `${section}.${path}`).toHaveProperty(path, {
      value,
      source,
    });
    expect(next.revision).toBe(
      scenario.revision +
        Number(section !== "finance" && path !== "pedestrian.count"),
    );
    expect(next.financeRevision).toBe(
      scenario.financeRevision + Number(section === "finance"),
    );
    scenario = next;
  }
  const { scenarios } = await listScenarios.run({}, founder);
  expect(scenarios.find(({ id }) => id === initial.id)).toEqual(scenario);
  expect(scenario.baseHourlyDemand).toBe(withFootfall.baseHourlyDemand);
  expect(scenario.demand.pedestrian?.count).toEqual(
    withFootfall.demand.pedestrian?.count,
  );
  expect(scenario.shop.workers[0]?.name).toBe(before.shop.workers[0]?.name);
});

test("tag edits reject unauthorized, missing, incompatible or stale input without changing the saved row", async () => {
  const { scenario } = await createScenario.run({}, founder);
  const edit = {
    id: scenario.id,
    section: "demand",
    path: "opensAt",
    expectedRevision: scenario.revision,
    source: estimate,
  } as const;
  await expect(tagSource.run(edit, other)).rejects.toMatchObject({
    errorCode: "scenario_not_found",
  });
  await expect(tagSource.run(edit, { caller: "http" })).rejects.toMatchObject({
    errorCode: "sign_in_required",
  });
  for (const source of [
    { tag: "public" },
    { ...publicSource, url: "file:///price-list" },
    { ...publicSource, retrievedAt: "2026-02-30" },
    { ...publicSource, supportingValue: "  " },
  ]) {
    expect(
      (await actionCallIntent(tagSourceAction, { ...edit, source })).valid,
    ).toBe(false);
  }
  expect(
    (await actionCallIntent(tagSourceAction, { ...edit, value: 90000 })).valid,
  ).toBe(false);
  expect(
    (await actionCallIntent(tagSourceAction, { ...edit, section: "finance" }))
      .valid,
  ).toBe(false);
  await expect(
    tagSource.run({ ...edit, path: "hourly.base.value" }, agent),
  ).rejects.toMatchObject({ errorCode: "invalid_scenario" });
  await expect(
    tagSource.run({ ...edit, path: "hourlyMultipliers.100" }, agent),
  ).rejects.toMatchObject({ errorCode: "invalid_scenario" });
  await expect(
    tagSource.run({ ...edit, path: "constructor.prototype" }, agent),
  ).rejects.toMatchObject({ errorCode: "invalid_scenario" });
  await expect(
    tagSource.run({ ...edit, path: "pedestrian.count" }, agent),
  ).rejects.toMatchObject({ errorCode: "invalid_scenario" });

  const { scenario: before } = await setPedestrianCount.run(
    {
      id: scenario.id,
      expectedRevision: scenario.revision,
      pedestrian: {
        count: { value: 200, source: observed },
        conversionPercent: { value: 20, source: estimate },
      },
    },
    founder,
  );
  await expect(tagSource.run(edit, agent)).rejects.toMatchObject({
    errorCode: "scenario_conflict",
  });
  await expect(
    tagSource.run(
      { ...edit, path: "pedestrian.count", expectedRevision: before.revision },
      agent,
    ),
  ).rejects.toMatchObject({ errorCode: "invalid_scenario" });
  expect(
    (await listScenarios.run({}, founder)).scenarios.find(
      ({ id }) => id === scenario.id,
    ),
  ).toEqual(before);
  expect((await listScenarios.run({}, other)).scenarios).toEqual([]);
});

test("service tags stale Saturday playback and finance tags only stale the cash receipt", async () => {
  const { scenario } = await createScenario.run({}, founder);
  const version = {
    id: scenario.id,
    expectedRevision: scenario.revision,
    expectedFinanceRevision: scenario.financeRevision,
  };
  const run = await runSimulation.run(
    { ...version, seed: 1, demandLevel: "base", runCount: 1 },
    founder,
  );
  await computeRunway.run({ ...version, runId: run.id }, founder);

  const financeEdit = {
    id: scenario.id,
    expectedFinanceRevision: scenario.financeRevision,
    section: "finance",
    path: "rent",
    source: estimate,
  } as const;
  await tagSource.run(financeEdit, agent);
  await expect(tagSource.run(financeEdit, agent)).rejects.toMatchObject({
    errorCode: "scenario_conflict",
  });
  const { scenario: unchanged } = await tagSource.run(
    { ...financeEdit, expectedFinanceRevision: 1 },
    agent,
  );
  expect(unchanged.financeRevision).toBe(1);
  expect(
    (await getSimulation.run({ id: scenario.id }, founder)).run?.stale,
  ).toBe(false);
  expect(
    (await getComparison.run({ aId: scenario.id }, founder)).decision,
  ).toMatchObject({ serviceStale: false, cashStale: true });

  await tagSource.run(
    {
      id: scenario.id,
      expectedRevision: scenario.revision,
      section: "demand",
      path: "hourly.base",
      source: observed,
    },
    agent,
  );
  expect(
    (await getSimulation.run({ id: scenario.id }, founder)).run,
  ).toMatchObject({ id: run.id, stale: true });
  expect(
    (await getComparison.run({ aId: scenario.id }, founder)).decision
      ?.serviceStale,
  ).toBe(true);
});
