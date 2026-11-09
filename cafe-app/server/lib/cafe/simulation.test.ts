import { assert, describe, expect, it } from "vitest";

import { createArrivalPlan, type Arrival, type ArrivalPlan } from "./arrivals";
import {
  simulateSaturday,
  simulateSeries,
  type Shop,
  type SimulationEvent,
} from "./simulation";

const hours = { opensAt: 0, closesAt: 120 };
const worker = { id: "first", shifts: [{ startsAt: 0, endsAt: 120 }] };
const equipment = { grinder: 2, groupHead: 1, steamWand: 1 };
const shop: Shop = {
  workers: [worker],
  equipment,
  menu: [{ id: "espresso", tasks: [{ id: "serve", staffSeconds: 10 }] }],
  patienceSeconds: 100,
};

function arrival(id: string, at: number, itemId = "espresso"): Arrival {
  return { id, at, itemId };
}

function starts(events: readonly SimulationEvent[]) {
  return events
    .filter((event) => event.kind === "task_started")
    .map(({ arrivalId, at, taskId, workerId }) => [
      arrivalId,
      taskId,
      at,
      workerId,
    ]);
}

describe("simulateSaturday", () => {
  it("uses the same staff pool for grinding and hand-off, and names that pool as the bottleneck", () => {
    const grindingShop: Shop = {
      ...shop,
      menu: [
        {
          id: "espresso",
          tasks: [
            { id: "grind", machine: "grinder", staffSeconds: 20 },
            { id: "handoff", staffSeconds: 10 },
          ],
        },
      ],
    };
    const arrivals = [arrival("a", 0), arrival("b", 0)];
    const baseline = simulateSaturday(grindingShop, { hours, arrivals });
    expect(starts(baseline.timeline)).toEqual([
      ["a", "grind", 0, "first"],
      ["b", "grind", 20, "first"],
      ["a", "handoff", 40, "first"],
      ["b", "handoff", 50, "first"],
    ]);
    expect(baseline.stats).toMatchObject({
      ordersServed: 2,
      customersLost: 0,
      waitP50Seconds: 25,
      waitP90Seconds: 29,
    });
    expect(baseline.stats.bottleneck).toMatchObject({
      resource: "staff",
      label: "Barista time",
      longestTaskWaitSeconds: 20,
      totalWaitSeconds: 50,
    });
    expect(baseline.stats.utilization).toEqual([
      {
        id: "first",
        kind: "worker",
        busySeconds: 60,
        availableSeconds: 120,
        fraction: 0.5,
      },
      {
        id: "grinder-1",
        kind: "grinder",
        busySeconds: 40,
        availableSeconds: 120,
        fraction: 1 / 3,
      },
      {
        id: "grinder-2",
        kind: "grinder",
        busySeconds: 0,
        availableSeconds: 120,
        fraction: 0,
      },
      {
        id: "groupHead-1",
        kind: "groupHead",
        busySeconds: 0,
        availableSeconds: 120,
        fraction: 0,
      },
      {
        id: "steamWand-1",
        kind: "steamWand",
        busySeconds: 0,
        availableSeconds: 120,
        fraction: 0,
      },
    ]);

    const twoWorkers = {
      ...grindingShop,
      workers: [worker, { ...worker, id: "second" }],
    };
    const staffed = simulateSaturday(twoWorkers, { hours, arrivals });
    expect(staffed.arrivals).toEqual(baseline.arrivals);
    expect(starts(staffed.timeline)).toEqual([
      ["a", "grind", 0, "first"],
      ["b", "grind", 0, "second"],
      ["a", "handoff", 20, "first"],
      ["b", "handoff", 20, "second"],
    ]);
    expect(staffed.stats.waitP90Seconds).toBe(0);
    expect(staffed.stats.bottleneck).toBeNull();

    const oneGrinder = simulateSaturday(
      { ...twoWorkers, equipment: { ...equipment, grinder: 1 } },
      { hours, arrivals },
    );
    expect(oneGrinder.stats.bottleneck).toMatchObject({
      resource: "grinder",
      longestTaskWaitSeconds: 20,
    });
  });

  it("releases the barista during extraction and holds the group head until the shot finishes", () => {
    const result = simulateSaturday(
      {
        ...shop,
        menu: [
          {
            id: "espresso",
            tasks: [
              {
                id: "pull",
                machine: "groupHead",
                staffSeconds: 10,
                unattendedSeconds: 30,
              },
            ],
          },
          { id: "tea", tasks: [{ id: "prep", staffSeconds: 20 }] },
        ],
      },
      {
        hours,
        arrivals: [arrival("a", 0), arrival("tea", 0, "tea"), arrival("b", 11)],
      },
    );
    expect(starts(result.timeline)).toEqual([
      ["a", "pull", 0, "first"],
      ["tea", "prep", 10, "first"],
      ["b", "pull", 40, "first"],
    ]);
    expect(
      result.timeline.find((event) => event.kind === "task_started"),
    ).toMatchObject({
      workerReleasedAt: 10,
      endsAt: 40,
      machineId: "groupHead-1",
    });
    expect(
      result.stats.utilization.find(({ kind }) => kind === "worker")
        ?.busySeconds,
    ).toBe(40);
    expect(
      result.stats.utilization.find(({ kind }) => kind === "groupHead")
        ?.busySeconds,
    ).toBe(80);
    expect(result.stats.bottleneck).toMatchObject({
      resource: "groupHead",
      longestTaskWaitSeconds: 19.5,
    });
  });

  it("keeps attended work within shifts, allows an exact-deadline start, and reports lost orders", () => {
    const result = simulateSaturday(
      {
        ...shop,
        workers: [
          { id: "short", shifts: [{ startsAt: 10, endsAt: 20 }] },
          { id: "later", shifts: [{ startsAt: 40, endsAt: 80 }] },
        ],
        menu: [{ id: "espresso", tasks: [{ id: "serve", staffSeconds: 15 }] }],
        patienceSeconds: 30,
      },
      {
        hours,
        arrivals: [arrival("a", 0), arrival("b", 10), arrival("c", 65)],
      },
    );
    expect(starts(result.timeline)).toEqual([
      ["b", "serve", 40, "later"],
      ["c", "serve", 65, "later"],
    ]);
    expect(
      result.timeline.filter((event) => event.kind === "customer_lost"),
    ).toEqual([
      { kind: "customer_lost", arrivalId: "a", at: 30, waitSeconds: 30 },
    ]);
    expect(result.stats).toMatchObject({
      ordersServed: 2,
      customersLost: 1,
      waitP50Seconds: 15,
      waitP90Seconds: 27,
    });
    expect(
      result.stats.utilization.filter(({ kind }) => kind === "worker"),
    ).toEqual([
      {
        id: "short",
        kind: "worker",
        busySeconds: 0,
        availableSeconds: 10,
        fraction: 0,
      },
      {
        id: "later",
        kind: "worker",
        busySeconds: 30,
        availableSeconds: 40,
        fraction: 0.75,
      },
    ]);
  });

  it("keeps the longer shift free for long jobs regardless of worker order", () => {
    const longer = { id: "longer", shifts: [{ startsAt: 0, endsAt: 300 }] };
    const shorter = { id: "shorter", shifts: [{ startsAt: 0, endsAt: 120 }] };
    const timedShop: Shop = {
      ...shop,
      menu: [...shop.menu, { id: "tea", tasks: [{ id: "brew", staffSeconds: 30 }] }],
      patienceSeconds: 5,
    };
    const saturday = {
      hours: { opensAt: 0, closesAt: 300 },
      arrivals: [arrival("quick", 100), arrival("slow", 100, "tea")],
    };
    const first = simulateSaturday({ ...timedShop, workers: [longer, shorter] }, saturday);
    const second = simulateSaturday({ ...timedShop, workers: [shorter, longer] }, saturday);
    expect(starts(first.timeline)).toEqual([
      ["quick", "serve", 100, "shorter"],
      ["slow", "brew", 100, "longer"],
    ]);
    expect(second.timeline).toEqual(first.timeline);
    expect(first.stats).toMatchObject({ ordersServed: 2, customersLost: 0, waitP90Seconds: 0 });
    expect(second.stats).toMatchObject({ ordersServed: 2, customersLost: 0, waitP90Seconds: 0 });
  });

  it("uses worker IDs to break a tie between shifts ending at the same time", () => {
    const result = simulateSaturday(
      { ...shop, workers: [{ ...worker, id: "second" }, worker] },
      { hours, arrivals: [arrival("a", 0)] },
    );
    expect(starts(result.timeline)).toEqual([["a", "serve", 0, "first"]]);
  });

  it("applies patience to all queue time and excludes time spent on tasks", () => {
    const result = simulateSaturday(
      {
        ...shop,
        workers: [
          {
            id: "first",
            shifts: [
              { startsAt: 5, endsAt: 15 },
              { startsAt: 35, endsAt: 80 },
            ],
          },
        ],
        menu: [
          {
            id: "espresso",
            tasks: [
              { id: "make", staffSeconds: 10 },
              { id: "serve", staffSeconds: 5 },
            ],
          },
        ],
        patienceSeconds: 20,
      },
      { hours, arrivals: [arrival("a", 0)] },
    );
    expect(starts(result.timeline)).toEqual([["a", "make", 5, "first"]]);
    expect(result.timeline[result.timeline.length - 1]).toEqual({
      kind: "customer_lost",
      arrivalId: "a",
      at: 30,
      waitSeconds: 20,
    });
    expect(result.stats).toMatchObject({
      ordersServed: 0,
      customersLost: 1,
      waitP50Seconds: null,
      waitP90Seconds: null,
    });
  });

  it("loses orders waiting for missing equipment and completes tasks already underway after closing", () => {
    const afterClose = simulateSaturday(
      {
        ...shop,
        workers: [{ id: "closer", shifts: [{ startsAt: 0, endsAt: 120 }] }],
        menu: [
          {
            id: "espresso",
            tasks: [
              {
                id: "pull",
                machine: "groupHead",
                staffSeconds: 5,
                unattendedSeconds: 30,
              },
            ],
          },
        ],
        patienceSeconds: 0,
      },
      { hours, arrivals: [arrival("a", 115)] },
    );
    expect(afterClose.timeline[afterClose.timeline.length - 1]).toEqual({
      kind: "order_served",
      at: 150,
      arrivalId: "a",
      waitSeconds: 0,
    });
    expect(
      afterClose.stats.utilization.find(({ kind }) => kind === "groupHead"),
    ).toMatchObject({ busySeconds: 35, availableSeconds: 150 });

    const missing = simulateSaturday(
      {
        ...shop,
        equipment: { ...equipment, steamWand: 0 },
        menu: [
          {
            id: "espresso",
            tasks: [{ id: "steam", machine: "steamWand", staffSeconds: 5 }],
          },
        ],
        patienceSeconds: 7,
      },
      { hours, arrivals: [arrival("a", 0)] },
    );
    expect(missing.timeline[missing.timeline.length - 1]).toEqual({
      kind: "customer_lost",
      at: 7,
      arrivalId: "a",
      waitSeconds: 7,
    });
    expect(missing.stats.bottleneck).toMatchObject({
      resource: "steamWand",
      longestTaskWaitSeconds: 7,
    });
  });

  it("returns an ordered immutable event timeline without modifying the caller's arrivals", () => {
    const arrivals = [arrival("late", 35), arrival("early", 0)];
    const result = simulateSaturday(shop, { hours, arrivals });
    expect(
      result.timeline.map(({ kind, at, arrivalId }) => [kind, at, arrivalId]),
    ).toEqual([
      ["arrived", 0, "early"],
      ["task_queued", 0, "early"],
      ["task_started", 0, "early"],
      ["task_completed", 10, "early"],
      ["order_served", 10, "early"],
      ["arrived", 35, "late"],
      ["task_queued", 35, "late"],
      ["task_started", 35, "late"],
      ["task_completed", 45, "late"],
      ["order_served", 45, "late"],
    ]);
    expect(arrivals.map(({ id }) => id)).toEqual(["late", "early"]);
    expect(Object.isFrozen(arrivals[0])).toBe(false);
    expect(Object.isFrozen(result.timeline)).toBe(true);
    expect(result.timeline.every(Object.isFrozen)).toBe(true);
    expect(result.arrivals.every(Object.isFrozen)).toBe(true);
  });

  it("rejects duplicate arrivals, unknown menu items, invalid durations, and overlapping shifts", () => {
    expect(() =>
      simulateSaturday(shop, {
        hours,
        arrivals: [arrival("a", 0), arrival("a", 10)],
      }),
    ).toThrow(RangeError);
    expect(() =>
      simulateSaturday(shop, { hours, arrivals: [arrival("a", 0, "tea")] }),
    ).toThrow(RangeError);
    expect(() =>
      simulateSaturday(
        {
          ...shop,
          menu: [{ id: "espresso", tasks: [{ id: "serve", staffSeconds: 0 }] }],
        },
        { hours, arrivals: [] },
      ),
    ).toThrow(RangeError);
    expect(() =>
      simulateSaturday(
        {
          ...shop,
          workers: [
            {
              id: "first",
              shifts: [
                { startsAt: 0, endsAt: 30 },
                { startsAt: 10, endsAt: 40 },
              ],
            },
          ],
        },
        { hours, arrivals: [] },
      ),
    ).toThrow(RangeError);
  });
});

describe("simulateSeries", () => {
  it("pools waits across runs, averages counts, and returns the first actual run for playback", () => {
    const seriesShop = { ...shop, patienceSeconds: 10 };
    const firstArrivals = [arrival("a", 0), arrival("b", 0)];
    const plan: ArrivalPlan = {
      seed: 7,
      demandLevel: "base",
      hours,
      runs: [firstArrivals, [arrival("c", 5), arrival("d", 119)]],
    };
    const result = simulateSeries(seriesShop, plan);
    expect(result.playback).toEqual(
      simulateSaturday(seriesShop, { hours, arrivals: firstArrivals }),
    );
    expect(result).toMatchObject({
      seed: 7,
      demandLevel: "base",
      runCount: 2,
      stats: {
        meanOrdersServed: 1.5,
        meanCustomersLost: 0.5,
        waitP50Seconds: 0,
        waitP90Seconds: 8,
      },
    });
    expect(
      result.stats.utilization.find(({ kind }) => kind === "worker"),
    ).toMatchObject({
      busySeconds: 15,
      availableSeconds: 120,
      fraction: 0.125,
    });
  });

  it("reuses complete arrivals across variants and reproduces the entire 100-run result", () => {
    const demand = {
      hours,
      hourly: { low: 100, base: 500, high: 700 },
      hourlyMultipliers: [1],
    };
    const mix = [{ itemId: "espresso", weight: 1 }];
    const plan = createArrivalPlan(demand, mix, 15);
    const baseline = simulateSeries(shop, plan);
    const staffed = simulateSeries(
      { ...shop, workers: [worker, { ...worker, id: "second" }] },
      plan,
    );
    expect(plan.runs).toEqual(createArrivalPlan(demand, mix, 15).runs);
    expect(baseline).toEqual(
      simulateSeries(shop, createArrivalPlan(demand, mix, 15)),
    );
    expect(staffed.playback.arrivals).toEqual(baseline.playback.arrivals);
    expect(staffed.stats.meanCustomersLost).toBeLessThan(
      baseline.stats.meanCustomersLost,
    );
    assert(typeof baseline.stats.waitP90Seconds === "number");
    expect(staffed.stats.waitP90Seconds).toBeLessThan(
      baseline.stats.waitP90Seconds,
    );
  });
});
