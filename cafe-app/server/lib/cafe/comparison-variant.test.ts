import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import createVariant from "../../../actions/create-barista-variant.js";
import migrate from "../../plugins/db.js";
import { readScenario, scenarioSchema } from "./scenario-store.js";
import { setDemand } from "./full-action-fixtures.js";

const owner = { caller: "tool", userEmail: "variant@example.invalid" } satisfies ActionRunContext;
const other = { caller: "tool", userEmail: "other@example.invalid" } satisfies ActionRunContext;
beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("creates a barista variant from the saved baseline", async () => {
  const { scenario: baseline } = await createScenario.run({ label: "Baseline", baseHourlyDemand: 40 }, owner);
  const version = { id: baseline.id, expectedRevision: baseline.revision, expectedFinanceRevision: baseline.financeRevision };
  const barista = scenarioSchema.parse((await createVariant.run({ ...version }, owner)).scenario);
  expect(barista.parentId).toBe(baseline.id);
  expect(barista.shop.workers).toEqual([...baseline.shop.workers, {
    id: "barista-2", name: "Barista 2", shifts: [{ startsAt: baseline.demand.opensAt, endsAt: baseline.demand.closesAt }],
  }]);
  expect(barista.finance).toEqual(baseline.finance);
  expect(await readScenario(baseline.id, owner.userEmail)).toEqual(baseline);
});

it("rejects stale or foreign baselines", async () => {
  const { scenario } = await createScenario.run({ baseHourlyDemand: 40 }, owner);
  const input = { id: scenario.id, expectedRevision: scenario.revision, expectedFinanceRevision: scenario.financeRevision };
  await expect(createVariant.run(input, other)).rejects.toMatchObject({ errorCode: "scenario_not_found" });
  await setDemand.run({ id: scenario.id, expectedRevision: scenario.revision, baseHourlyDemand: 41 }, owner);
  await expect(createVariant.run(input, owner)).rejects.toMatchObject({ errorCode: "scenario_conflict" });
});
