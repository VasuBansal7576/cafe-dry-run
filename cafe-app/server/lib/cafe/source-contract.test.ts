import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it } from "vitest";

import compareScenarios from "../../../actions/compare-scenarios.js";
import computeRunway from "../../../actions/compute-runway.js";
import configureFinance from "../../../actions/configure-finance.js";
import configureShop from "../../../actions/configure-shop.js";
import createScenario from "../../../actions/create-scenario.js";
import explainResult from "../../../actions/explain-result.js";
import getComparison from "../../../actions/get-comparison.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import setPedestrianCount from "../../../actions/set-pedestrian-count.js";
import migrate from "../../plugins/db.js";
import type { Scenario } from "./scenario-store.js";

const owner = {
  caller: "tool",
  userEmail: "founder@example.invalid",
} satisfies ActionRunContext;
const other = {
  caller: "tool",
  userEmail: "other@example.invalid",
} satisfies ActionRunContext;
const settings = { seed: 42, runCount: 2, demandLevel: "base" } as const;
const estimated = (value: number) => ({
  value,
  source: { tag: "estimate" as const },
});
const serviceVersion = ({ id, revision }: Scenario) => ({
  id,
  expectedRevision: revision,
});
const versions = (scenario: Scenario) => ({
  ...serviceVersion(scenario),
  expectedFinanceRevision: scenario.financeRevision,
});

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("returns quote-ready service and cash figures without changing the underlying receipt", async () => {
  const { scenario: a } = await createScenario.run(
    { baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    {
      ...versions(a),
      variantLabel: "Cover barista",
      shop: {
        workers: [
          ...a.shop.workers,
          { id: "cover", name: "Cover", shifts: a.shop.workers[0]!.shifts },
        ],
      },
    },
    owner,
  );
  const options = { seed: 42, runCount: 24, demandLevel: "base" as const };
  const run = await runSimulation.run(
    { ...serviceVersion(a), ...options },
    owner,
  );
  expect(run.summary.stats.waitP50Seconds).toBe(215.169523362787);
  expect(run).toMatchObject({
    chatFigures: { waitP50: { text: "215.17 seconds", tag: "illustrative" } },
  });
  const saved = await getSimulation.run(
    { id: a.id, runId: run.id, includePlayback: false },
    owner,
  );
  expect(saved).toMatchObject({ chatFigures: run.chatFigures });

  const comparison = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...options },
    owner,
  );
  const scope = { aId: a.id, bId: b.id };
  expect(comparison.chatFigures?.["scenarioA.waitP50"]).toEqual(
    run.chatFigures.waitP50,
  );
  expect(comparison.chatFigures?.["scenarioA.waitP90"]?.text).toBe(
    "286.90 seconds",
  );
  expect(comparison.chatFigures?.["scenarioA.meanCustomersLost"]?.text).toBe(
    "278.33 customers lost per Saturday",
  );
  expect(comparison.chatFigures?.["scenarioB.waitP50"]?.text).toBe(
    "96.79 seconds",
  );
  expect(comparison.chatFigures?.["scenarioB.meanOrdersServed"]?.text).toBe(
    "298.29 orders served per Saturday",
  );
  expect(comparison.chatFigures?.["bMinusA.monthlyCash"]?.text).toMatch(
    /^[+\-]?₹[\d,.]+ per month$/,
  );
  expect((await getComparison.run(scope, owner)).decision).toEqual(comparison);
  expect(await explainResult.run(scope, owner)).toMatchObject({
    chatFigures: comparison.chatFigures,
  });
  await expect(explainResult.run(scope, other)).resolves.not.toHaveProperty(
    "chatFigures",
  );

  await configureFinance.run(
    { ...versions(a), finance: { rent: estimated(61_000) } },
    owner,
  );
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    cashStale: true,
    chatFigures: null,
  });
  expect(await explainResult.run(scope, owner)).not.toHaveProperty(
    "chatFigures",
  );
});

it("returns conditional no-count conversions from the saved solo runway and requires a refresh after edits", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const key = serviceVersion(scenario);
  const before = await setPedestrianCount.run(key, owner);
  expect(before.expectedSaturdayArrivals).toBeNull();
  expect(before.requiredConversion).toMatchObject({ kind: "needs-runway" });
  await expect(setPedestrianCount.run(key, other)).rejects.toThrow(
    "Scenario not found",
  );

  const run = await runSimulation.run({ ...key, ...settings }, owner);
  const { receipt } = await computeRunway.run(
    { ...versions(scenario), runId: run.id },
    owner,
  );
  const observed = await setPedestrianCount.run(key, owner);
  expect(observed.chatFigures?.["scenarioA.illustrativeCaptureRate.0"]).toEqual(
    {
      text: "30% at 100 illustrative passers-by per open day",
      tag: "illustrative",
    },
  );
  const { breakEvenOrdersPerDay, illustrativeCaptureRates } = receipt.a.cash;
  expect(breakEvenOrdersPerDay.value).toBeGreaterThan(0);
  expect(observed.requiredConversion).toEqual({
    kind: "conditional",
    receiptId: receipt.id,
    a: {
      scenarioId: scenario.id,
      breakEvenOrdersPerDay,
      illustrativeCaptureRates,
    },
    b: null,
  });
  expect(illustrativeCaptureRates).toHaveLength(3);
  for (const { passersByPerOpenDay, rate } of illustrativeCaptureRates) {
    expect(passersByPerOpenDay.tag).toBe("illustrative");
    expect(rate).toEqual({
      value: breakEvenOrdersPerDay.value! / passersByPerOpenDay.value,
      tag: "illustrative",
    });
  }
  expect(observed.scenario.revision).toBe(scenario.revision);
  await configureFinance.run(
    {
      id: scenario.id,
      expectedFinanceRevision: scenario.financeRevision,
      finance: { rent: estimated(61_000) },
    },
    owner,
  );
  expect(
    (await setPedestrianCount.run(key, owner)).requiredConversion,
  ).toMatchObject({ kind: "stale-runway" });
});

it("reads both sides of a fresh matched receipt using the shared arrival source and rejects unrelated sources", async () => {
  const { scenario: original } = await createScenario.run({}, owner);
  const { scenario: a } = await configureShop.run(
    { ...versions(original), variantLabel: "Barista" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...versions(original), variantLabel: "Grinder" },
    owner,
  );
  const comparison = { aId: a.id, bId: b.id };
  const key = serviceVersion(original);
  expect(
    (await setPedestrianCount.run({ ...key, comparison }, owner))
      .requiredConversion,
  ).toMatchObject({ kind: "needs-runway" });

  const { receipt } = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...settings },
    owner,
  );
  const result = await setPedestrianCount.run({ ...key, comparison }, owner);
  expect(result.requiredConversion).toEqual({
    kind: "conditional",
    receiptId: receipt.id,
    a: {
      scenarioId: a.id,
      breakEvenOrdersPerDay: receipt.a.cash.breakEvenOrdersPerDay,
      illustrativeCaptureRates: receipt.a.cash.illustrativeCaptureRates,
    },
    b: {
      scenarioId: b.id,
      breakEvenOrdersPerDay: receipt.b!.cash.breakEvenOrdersPerDay,
      illustrativeCaptureRates: receipt.b!.cash.illustrativeCaptureRates,
    },
  });
  await expect(
    setPedestrianCount.run({ ...serviceVersion(a), comparison }, owner),
  ).rejects.toThrow("shared arrival source");
});

it("still saves and clears observed counts without substituting an assumed count", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const pedestrian = {
    count: { value: 600, source: { tag: "observed" as const } },
    conversionPercent: estimated(10),
  };
  const observed = await setPedestrianCount.run(
    { ...serviceVersion(scenario), pedestrian },
    owner,
  );
  expect(observed).toMatchObject({
    scenario: { demand: { pedestrian } },
    expectedSaturdayArrivals: { value: 60, tag: "estimate" },
    requiredConversion: null,
  });
  expect(
    await setPedestrianCount.run(serviceVersion(observed.scenario), owner),
  ).toEqual(observed);
  await expect(
    setPedestrianCount.run(
      { ...serviceVersion(scenario), pedestrian: null },
      owner,
    ),
  ).rejects.toThrow("changed");
  const cleared = await setPedestrianCount.run(
    { ...serviceVersion(observed.scenario), pedestrian: null },
    owner,
  );
  expect(cleared).toMatchObject({
    scenario: { demand: { pedestrian: null, hourly: scenario.demand.hourly } },
    expectedSaturdayArrivals: null,
    requiredConversion: { kind: "needs-runway" },
  });
});

it("lets finance-only configure-shop edits coexist with a simultaneous service edit", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const cash = estimated(230_000);
  const patienceSeconds = estimated(120);
  await Promise.all([
    configureShop.run(
      {
        id: scenario.id,
        expectedFinanceRevision: scenario.financeRevision,
        finance: { cash },
      },
      owner,
    ),
    configureShop.run(
      { ...serviceVersion(scenario), shop: { patienceSeconds } },
      owner,
    ),
  ]);
  const read = (await listScenarios.run({}, owner)).scenarios.find(
    ({ id }) => id === scenario.id,
  );
  expect(read).toMatchObject({
    revision: scenario.revision + 1,
    financeRevision: scenario.financeRevision + 1,
    shop: { patienceSeconds },
    finance: { cash },
  });
});

it("commits combined shop and money edits atomically and rejects either stale revision", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const patienceSeconds = estimated(124);
  const cash = estimated(500_000);
  const edit = {
    ...versions(scenario),
    shop: { patienceSeconds },
    finance: { cash },
  };
  await expect(configureShop.run(edit, other)).rejects.toThrow(
    "Scenario not found",
  );
  await expect(
    configureShop.run(
      {
        ...edit,
        finance: {
          ...edit.finance,
          weekdaysPerMonth: estimated(23),
          weekendsPerMonth: estimated(10),
        },
      },
      owner,
    ),
  ).rejects.toThrow("Total open days cannot exceed 31");
  const read = async () =>
    (await listScenarios.run({}, owner)).scenarios.find(
      ({ id }) => id === scenario.id,
    );
  expect(await read()).toEqual(scenario);

  const { scenario: changed } = await configureShop.run(edit, owner);
  expect(changed).toMatchObject({
    revision: scenario.revision + 1,
    financeRevision: scenario.financeRevision + 1,
    shop: { patienceSeconds },
    finance: { cash },
  });
  await expect(
    configureShop.run({ ...edit, expectedRevision: changed.revision }, owner),
  ).rejects.toThrow("changed");
  await expect(
    configureShop.run(
      { ...edit, expectedFinanceRevision: changed.financeRevision },
      owner,
    ),
  ).rejects.toThrow("changed");
  expect(await read()).toEqual(changed);
});

it("allows only one concurrent combined edit and stales only the affected results", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const run = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings },
    owner,
  );
  await computeRunway.run({ ...versions(scenario), runId: run.id }, owner);
  const { scenario: moneyEdited } = await configureShop.run(
    {
      id: scenario.id,
      expectedFinanceRevision: scenario.financeRevision,
      finance: { rent: estimated(33_000) },
    },
    owner,
  );
  const scope = { aId: scenario.id };
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    serviceStale: false,
    cashStale: true,
  });
  expect(
    (await getSimulation.run({ id: scenario.id }, owner)).run,
  ).toMatchObject({ id: run.id, stale: false });

  const first = {
    shop: { patienceSeconds: estimated(99) },
    finance: { rent: estimated(34_000) },
  };
  const second = {
    shop: { patienceSeconds: estimated(101) },
    finance: { rent: estimated(35_000) },
  };
  const edits = [first, second];
  const attempts = await Promise.allSettled(
    edits.map((edit) =>
      configureShop.run({ ...versions(moneyEdited), ...edit }, owner),
    ),
  );
  expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
    reason: { message: expect.stringContaining("changed") },
  });
  const winner =
    edits[attempts.findIndex(({ status }) => status === "fulfilled")];
  const persisted = (await listScenarios.run({}, owner)).scenarios.find(
    ({ id }) => id === scenario.id,
  );
  expect(persisted).toMatchObject({
    ...winner,
    revision: moneyEdited.revision + 1,
    financeRevision: moneyEdited.financeRevision + 1,
  });
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    serviceStale: true,
    cashStale: true,
  });
});
