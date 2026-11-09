import { describe, expect, it } from "vitest";

import { calculateDecision } from "./decision";
import { defaultFinance } from "./finance";
import { illustrative } from "./provenance";
import { defaultDemand, defaultShop } from "./scenario";
import type { Scenario } from "./scenario-store";

function scenario(id: string): Scenario {
  return {
    id,
    label: id === "a" ? "One barista" : "Two baristas",
    parentId: null,
    revision: 0,
    financeRevision: 0,
    finance: defaultFinance(),
    baseHourlyDemand: 55,
    demand: defaultDemand(55),
    shop: defaultShop(),
    latestRunId: null,
  };
}

const parameters = { seed: 1, runCount: 1, demandLevel: "base" as const };

describe("paired café decisions", () => {
  it("uses each drink's tagged economics for the side's weekday mix and the shared Saturday mix", () => {
    const a = scenario("a");
    const b = scenario("b");
    for (const side of [a, b]) {
      side.finance.weekdaysPerMonth = illustrative(1);
      side.finance.weekendsPerMonth = illustrative(1);
      side.finance.weekdayDemand.base = illustrative(100);
    }
    a.shop.menu[0]!.weight = illustrative(100);
    a.shop.menu[1]!.weight = illustrative(0);
    b.shop.menu[0]!.weight = illustrative(0);
    b.shop.menu[1]!.weight = illustrative(100);
    b.shop.menu[0]!.economics = {
      price: { value: 210, source: { tag: "estimate" } },
      ingredientCost: illustrative(70),
    };
    b.shop.menu[1]!.economics = {
      price: { value: 400, source: { tag: "observed" } },
      ingredientCost: illustrative(110),
    };
    const result = calculateDecision(a, b, parameters, {
      enabled: false,
      tag: "estimate",
    });
    const cash = result.cashB!;
    expect(cash.assumptions.weekdayUnitEconomics.price.value).toBe(400);
    expect(cash.assumptions.weekendUnitEconomics.price.value).toBe(210);
    expect(cash.outcomes.base.monthlyRevenue.value).toBeCloseTo(
      40_000 + 210 * cash.outcomes.base.weekendOrdersPerDay.value,
      2,
    );
    expect(cash.outcomes.base.monthlyIngredientCost.value).toBeCloseTo(
      11_000 + 70 * cash.outcomes.base.weekendOrdersPerDay.value,
      2,
    );
  });

  it("feeds observed Saturday footfall into Saturday demand and capture while keeping weekday inputs", () => {
    const a = scenario("a");
    a.demand.pedestrian = {
      count: { value: 600, source: { tag: "observed" } },
      conversionPercent: { value: 10, source: { tag: "estimate" } },
    };
    a.demand.hourlyMultipliers[0] = illustrative(2);
    const { cashA, weekendDemand } = calculateDecision(a, null, parameters, {
      enabled: false,
      tag: "estimate",
    });
    expect(weekendDemand.base).toMatchObject({
      value: 60,
      tag: "illustrative",
    });
    expect(cashA.outcomes.base.weekdayOrdersPerDay.value).toBe(70);
    expect(cashA.assumptions.passersByPerOpenDay).toEqual({
      value: 600,
      tag: "observed",
    });
    expect(cashA.requiredCaptureRate?.value).toBe(
      cashA.breakEvenOrdersPerDay.value! / 600,
    );
  });

  it("keeps each candidate's cash anchored to the original Saturday when it moves into A", () => {
    const original = scenario("original");
    const barista = { ...scenario("barista"), parentId: original.id };
    barista.shop.workers.push({
      id: "cover",
      name: "Cover",
      shifts: [
        { startsAt: illustrative(10 * 3600), endsAt: illustrative(12 * 3600) },
      ],
    });
    const grinder = { ...scenario("grinder"), parentId: original.id };
    grinder.shop.equipment.grinder = illustrative(2);
    const assumption = { enabled: false, tag: "estimate" as const };
    const versusBarista = calculateDecision(
      original,
      barista,
      parameters,
      assumption,
    );
    const versusGrinder = calculateDecision(
      original,
      grinder,
      parameters,
      assumption,
    );
    const direct = calculateDecision(
      barista,
      grinder,
      parameters,
      assumption,
      original,
    );
    expect(direct.serviceA.playback.arrivals).toHaveLength(334);
    expect(direct.serviceA.playback.arrivals).toEqual(
      direct.serviceB?.playback.arrivals,
    );
    expect(direct.weekend.base.arrivalDigest).toBe(
      versusGrinder.weekend.base.arrivalDigest,
    );
    expect(direct.cashA.outcomes.base.monthlyCash).toEqual(
      versusBarista.cashB?.outcomes.base.monthlyCash,
    );
    expect(direct.cashB?.outcomes.base.monthlyCash).toEqual(
      versusGrinder.cashB?.outcomes.base.monthlyCash,
    );
    expect(direct.delta?.monthlyCash.value).toBe(2400);
  });

  it("pairs arrival identities, timestamps and drink choices even when B has different standalone demand", () => {
    const a = scenario("a");
    const b = { ...scenario("b"), demand: defaultDemand(0) };
    const result = calculateDecision(a, b, parameters, {
      enabled: false,
      tag: "estimate",
    });
    expect(result.serviceA.playback.arrivals).toEqual(
      result.serviceB?.playback.arrivals,
    );
    expect(result.serviceA.playback.arrivals.length).toBeGreaterThan(0);
    expect(result.weekend.base.arrivals).toBe(
      result.serviceA.playback.arrivals.length,
    );
  });

  it("uses matched actual sample counts before applying a loss fraction to projected weekend demand", () => {
    const a = scenario("a");
    const b = scenario("b");
    b.shop.workers = [
      {
        id: "cover",
        name: "Cover",
        shifts: [
          { startsAt: illustrative(8 * 3600), endsAt: illustrative(14 * 3600) },
        ],
      },
      ...b.shop.workers,
    ];
    const off = calculateDecision(a, b, parameters, {
      enabled: false,
      tag: "estimate",
    });
    const on = calculateDecision(a, b, parameters, {
      enabled: true,
      tag: "estimate",
    });
    const arrivals = off.serviceA.playback.arrivals.length;
    const lostA = off.serviceA.playback.stats.customersLost;
    const lostB = off.serviceB!.playback.stats.customersLost;
    expect(arrivals).not.toBe(330);
    expect(lostA).toBeGreaterThan(lostB);
    expect(off.cashA.outcomes.base.weekendOrdersPerDay.value).toBeCloseTo(
      330 * (1 - lostA / arrivals),
      9,
    );
    expect(off.cashB?.outcomes.base.weekendOrdersPerDay.value).toBe(
      off.cashA.outcomes.base.weekendOrdersPerDay.value,
    );
    expect(on.cashB?.outcomes.base.weekendOrdersPerDay.value).toBeCloseTo(
      330 * (1 - lostB / arrivals),
      9,
    );
    expect(on.cashB?.outcomes.base.weekdayOrdersPerDay.value).toBe(
      off.cashB?.outcomes.base.weekdayOrdersPerDay.value,
    );
    expect(on.cashA.outcomes.base.monthlyCash.value).toBe(
      off.cashA.outcomes.base.monthlyCash.value,
    );
    expect(on.cashB?.outcomes.base.monthlyCash.value).toBeGreaterThan(
      off.cashB!.outcomes.base.monthlyCash.value,
    );
  });

  it("retains independent weekday staff, costs and input provenance", () => {
    const a = scenario("a");
    a.finance.weekdayDemand.base = { value: 90, source: { tag: "observed" } };
    a.finance.weekdayLossPercent = { value: 10, source: { tag: "estimate" } };
    a.finance.weekdaysPerMonth = { value: 20, source: { tag: "observed" } };
    a.finance.weekendsPerMonth = { value: 0, source: { tag: "observed" } };
    a.finance.weekdayStaffCount = { value: 2, source: { tag: "observed" } };
    a.finance.weekdayHoursPerWorker = { value: 5, source: { tag: "observed" } };
    a.finance.hourlyWage = { value: 100, source: { tag: "estimate" } };
    const { cashA } = calculateDecision(a, null, parameters, {
      enabled: false,
      tag: "estimate",
    });
    expect(cashA.outcomes.base.weekdayOrdersPerDay).toEqual({
      value: 81,
      tag: "estimate",
    });
    expect(cashA.outcomes.base.monthlyOrders).toEqual({
      value: 1620,
      tag: "estimate",
    });
    expect(cashA.costs.weekdayStaff).toEqual({ value: 20000, tag: "estimate" });
    expect(cashA.costs.weekendStaff).toEqual({ value: 0, tag: "observed" });
  });
});
