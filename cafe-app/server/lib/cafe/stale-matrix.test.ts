import type { ActionRunContext } from '@agent-native/core/action';
import { closeDbExec } from '@agent-native/core/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import createScenario from '../../../actions/create-scenario.js';
import getSimulation from '../../../actions/get-simulation.js';
import runSimulation from '../../../actions/run-simulation.js';
import migrate from '../../plugins/db.js';
import { configureShop, setDemand } from './full-action-fixtures.js';
import { illustrative } from './provenance.js';

const owner = { caller: 'tool', userEmail: 'matrix@example.invalid' } satisfies ActionRunContext;
beforeAll(async () => { await migrate({}); });
afterAll(() => closeDbExec());

for (const field of ['workers', 'equipment', 'menu', 'patienceSeconds'] as const) {
  it(`invalidates the saved service run after the ${field} shop edit`, async () => {
    const { scenario } = await createScenario.run({ label: `Matrix ${field}`, baseHourlyDemand: 30 }, owner);
    const run = await runSimulation.run({ id: scenario.id, expectedRevision: scenario.revision, seed: 42, demandLevel: 'base', runCount: 1 }, owner);
    expect((await getSimulation.run({ id: scenario.id, runId: run.id }, owner)).run?.stale).toBe(false);
    const shop = structuredClone(scenario.shop);
    if (field === 'workers') shop.workers[0]!.shifts[0]!.startsAt = illustrative(9 * 3600);
    if (field === 'equipment') shop.equipment.grinder = illustrative(2);
    if (field === 'menu') shop.menu[0]!.tasks[0]!.staffSeconds = illustrative(40);
    if (field === 'patienceSeconds') shop.patienceSeconds = illustrative(360);
    await configureShop.run({ id: scenario.id, expectedRevision: scenario.revision, shop: { [field]: shop[field] } }, owner);
    expect((await getSimulation.run({ id: scenario.id, runId: run.id }, owner)).run?.stale).toBe(true);
  });
}
for (const field of ['hourly', 'opensAt', 'closesAt', 'hourlyMultipliers', 'pedestrian'] as const) {
  it(`invalidates the saved service run after the ${field} demand edit`, async () => {
    const { scenario } = await createScenario.run({ label: `Matrix demand ${field}`, baseHourlyDemand: 30 }, owner);
    const run = await runSimulation.run({ id: scenario.id, expectedRevision: scenario.revision, seed: 42, demandLevel: 'base', runCount: 1 }, owner);
    expect((await getSimulation.run({ id: scenario.id, runId: run.id }, owner)).run?.stale).toBe(false);
    const demand = structuredClone(scenario.demand);
    if (field === 'hourly') demand.hourly.base = illustrative(31);
    if (field === 'opensAt') demand.opensAt = illustrative(9 * 3600);
    if (field === 'closesAt') demand.closesAt = illustrative(15 * 3600);
    if (field === 'hourlyMultipliers') demand.hourlyMultipliers[0] = illustrative(1.2);
    if (field === 'pedestrian') demand.pedestrian = { count: { value: 300, source: { tag: 'observed' } }, conversionPercent: illustrative(10) };
    await setDemand.run({ id: scenario.id, expectedRevision: scenario.revision, demand: { [field]: demand[field] ?? null } }, owner);
    expect((await getSimulation.run({ id: scenario.id, runId: run.id }, owner)).run?.stale).toBe(true);
  });
}
