import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import migrate from "../../plugins/db.js";
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
