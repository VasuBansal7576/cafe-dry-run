import { assert, describe, expect, it } from "vitest";

import { createArrivalPlan, type Demand } from "./arrivals";

const demand: Demand = {
  hours: { opensAt: 36_000, closesAt: 46_800 },
  hourly: { low: 0, base: 60, high: 120 },
  hourlyMultipliers: [0, 1, 0.1],
};

const menuMix = [
  { itemId: "latte", weight: 3 },
  { itemId: "espresso", weight: 1 },
  { itemId: "tea", weight: 0 },
];

describe("createArrivalPlan", () => {
  it("replays the same complete arrivals for 100 runs and changes them for another seed", () => {
    const plan = createArrivalPlan(demand, menuMix, 7);
    expect(plan.runs).toHaveLength(100);
    expect(plan).toEqual(createArrivalPlan(demand, menuMix, 7));
    expect(plan.runs[0]).not.toEqual(plan.runs[1]);
    expect(plan.runs[0]).not.toEqual(
      createArrivalPlan(demand, menuMix, 8, 1).runs[0],
    );
    expect(plan.runs[0]).toEqual(
      createArrivalPlan(demand, menuMix, 7, 1).runs[0],
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.hours)).toBe(true);
    expect(Object.isFrozen(plan.runs)).toBe(true);
    const firstRun = plan.runs[0];
    assert(firstRun && firstRun[0]);
    expect(Object.isFrozen(firstRun)).toBe(true);
    expect(Object.isFrozen(firstRun[0])).toBe(true);
  });

  it("uses the selected demand level, hourly curve, and menu weights", () => {
    const low = createArrivalPlan(demand, menuMix, 7, 2, "low");
    const base = createArrivalPlan(demand, menuMix, 7, 2, "base");
    const high = createArrivalPlan(demand, menuMix, 7, 2, "high");
    expect(low.runs).toEqual([[], []]);
    const run = base.runs[0];
    const highRun = high.runs[0];
    assert(run && highRun);
    expect(highRun.length).toBeGreaterThan(run.length);
    expect(
      run.every((arrival) => arrival.at >= 39_600 && arrival.at < 46_800),
    ).toBe(true);
    expect(run.filter((arrival) => arrival.at < 43_200).length).toBeGreaterThan(
      run.filter((arrival) => arrival.at >= 43_200).length,
    );
    expect(run.map((arrival) => arrival.at)).toEqual(
      run.map((arrival) => arrival.at).sort((a, b) => a - b),
    );
    expect(new Set(run.map((arrival) => arrival.id)).size).toBe(run.length);
    expect(new Set(run.map((arrival) => arrival.itemId))).toEqual(
      new Set(["latte", "espresso"]),
    );
    expect(
      run.filter((arrival) => arrival.itemId === "latte").length,
    ).toBeGreaterThan(
      run.filter((arrival) => arrival.itemId === "espresso").length,
    );
  });

  it("clips a final partial hour to closing time", () => {
    const plan = createArrivalPlan(
      {
        ...demand,
        hours: { opensAt: 36_000, closesAt: 39_900 },
        hourlyMultipliers: [0, 5],
      },
      menuMix,
      7,
      1,
    );
    const run = plan.runs[0];
    assert(run);
    expect(run.length).toBeGreaterThan(0);
    expect(
      run.every((arrival) => arrival.at >= 39_600 && arrival.at < 39_900),
    ).toBe(true);
  });

  it("rejects impossible demand, seed, menu weights, and run counts", () => {
    expect(() =>
      createArrivalPlan(
        { ...demand, hourly: { low: 60, base: 0, high: 120 } },
        menuMix,
        7,
      ),
    ).toThrow(RangeError);
    expect(() =>
      createArrivalPlan({ ...demand, hourlyMultipliers: [1] }, menuMix, 7),
    ).toThrow(RangeError);
    expect(() =>
      createArrivalPlan(demand, [{ itemId: "latte", weight: 0 }], 7),
    ).toThrow(RangeError);
    expect(() => createArrivalPlan(demand, menuMix, -1)).toThrow(RangeError);
    expect(() => createArrivalPlan(demand, menuMix, 7, 0)).toThrow(RangeError);
  });
});
