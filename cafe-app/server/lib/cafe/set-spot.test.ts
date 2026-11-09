import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec } from "@agent-native/core/db";
import { afterAll, beforeAll, expect, it } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import setDemand from "../../../actions/set-demand.js";
import setSpot from "../../../actions/set-spot.js";
import migrate from "../../plugins/db.js";

const owner = {
  caller: "tool",
  userEmail: "owner@example.invalid",
} satisfies ActionRunContext;
const other = {
  caller: "tool",
  userEmail: "other@example.invalid",
} satisfies ActionRunContext;

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("moves only the site pin and returns attributed places without staling a saved run", async () => {
  const { scenario } = await createScenario.run(
    { baseHourlyDemand: 29 },
    owner,
  );
  const { id, revision, spotRevision } = scenario;
  const parameters = { id, includePlayback: true };
  const service = await runSimulation.run(
    {
      id,
      expectedRevision: revision,
      seed: 42,
      demandLevel: "base",
      runCount: 2,
    },
    owner,
  );
  const before = await getSimulation.run(parameters, owner);
  const edit = {
    id,
    expectedSpotRevision: spotRevision,
    location: { placeName: "Indiranagar Metro" },
  };
  const changed = await setSpot.run(edit, owner);
  expect(changed.spot).toEqual({
    label: "Near Indiranagar Metro",
    lat: 12.9783325,
    lon: 77.6386612,
  });
  expect(changed.spotRevision).toBe(1);
  expect(changed.map).toMatchObject({
    coverage: "partial",
    source: {
      tag: "public",
      attribution: "© OpenStreetMap contributors",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      retrievedAt: "2026-11-09T09:43:45Z",
    },
  });
  expect(changed.map.places).toContainEqual(
    expect.objectContaining({
      group: "transit",
      osmId: 6400857551,
      distanceMetres: 0,
    }),
  );
  expect(await setSpot.run(edit, owner)).toEqual(changed);
  expect((await listScenarios.run({}, owner)).scenarios).toContainEqual({
    ...scenario,
    spot: changed.spot,
    spotRevision: 1,
    latestRunId: service.id,
  });
  expect(before.run?.stale).toBe(false);
  expect(await getSimulation.run(parameters, owner)).toEqual(before);
});

it("rejects another owner and outdated pin edits while allowing concurrent demand edits", async () => {
  const {
    scenario: { id },
  } = await createScenario.run({ baseHourlyDemand: 20 }, owner);
  const move = {
    id,
    expectedSpotRevision: 0,
    location: { lat: 12.955, lon: 77.64 },
  };
  await expect(setSpot.run(move, other)).rejects.toMatchObject({
    errorCode: "scenario_not_found",
  });
  await expect(setSpot.run(move, { caller: "tool" })).rejects.toMatchObject({
    errorCode: "sign_in_required",
  });
  const [pin, demand] = await Promise.all([
    setSpot.run(move, owner),
    setDemand.run({ id, expectedRevision: 0, baseHourlyDemand: 24 }, owner),
  ]);
  expect(pin.map).toMatchObject({ coverage: "outside", places: [] });
  expect(pin.spot).toEqual({
    label: "Pinned coordinates",
    lat: 12.955,
    lon: 77.64,
  });
  expect(demand.scenario.revision).toBe(1);
  await expect(
    setSpot.run({ ...move, location: { lat: 12.97, lon: 77.64 } }, owner),
  ).rejects.toMatchObject({ errorCode: "scenario_conflict" });
  expect(
    (await listScenarios.run({}, owner)).scenarios.find((row) => row.id === id),
  ).toMatchObject({
    spot: pin.spot,
    spotRevision: 1,
    revision: 1,
    baseHourlyDemand: 24,
  });
});
