export const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const UINT32_RANGE = 0x1_0000_0000;

export interface ServiceHours {
  readonly opensAt: number;
  readonly closesAt: number;
}

export type DemandLevel = "low" | "base" | "high";

export interface Demand {
  readonly hours: ServiceHours;
  readonly hourly: Readonly<Record<DemandLevel, number>>;
  readonly hourlyMultipliers: readonly number[];
}

export interface MenuMixEntry {
  readonly itemId: string;
  readonly weight: number;
}

export interface Arrival {
  readonly id: string;
  readonly at: number;
  readonly itemId: string;
}

export interface ArrivalPlan {
  readonly seed: number;
  readonly demandLevel: DemandLevel;
  readonly hours: ServiceHours;
  readonly runs: readonly (readonly Arrival[])[];
}

export function assertServiceHours({ opensAt, closesAt }: ServiceHours): void {
  if (
    !Number.isFinite(opensAt) ||
    !Number.isFinite(closesAt) ||
    opensAt < 0 ||
    closesAt > SECONDS_PER_DAY ||
    opensAt >= closesAt
  ) {
    throw new RangeError(
      "Opening and closing times must define a window within Saturday.",
    );
  }
}

function randomStream(seed: number): () => number {
  let state = seed;
  // Mulberry32 with an open interval so exponential waits are always positive.
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / UINT32_RANGE;
  };
}

export function createArrivalPlan(
  demand: Demand,
  menuMix: readonly MenuMixEntry[],
  seed: number,
  runCount = 100,
  demandLevel: DemandLevel = "base",
): ArrivalPlan {
  assertServiceHours(demand.hours);
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new RangeError("Seed must be an unsigned 32-bit integer.");
  }
  if (!Number.isSafeInteger(runCount) || runCount < 1) {
    throw new RangeError("At least one run is required.");
  }
  const { low, base, high } = demand.hourly;
  const hourlyRate = demand.hourly[demandLevel];
  if (
    !Number.isFinite(hourlyRate) ||
    !Number.isFinite(high) ||
    !(0 <= low && low <= base && base <= high)
  ) {
    throw new RangeError("Hourly rates must satisfy 0 ≤ low ≤ base ≤ high.");
  }

  const hours = Object.freeze({ ...demand.hours });
  const hourCount = Math.ceil(
    (hours.closesAt - hours.opensAt) / SECONDS_PER_HOUR,
  );
  if (
    demand.hourlyMultipliers.length !== hourCount ||
    demand.hourlyMultipliers.some(
      (multiplier) =>
        !Number.isFinite(multiplier) ||
        multiplier < 0 ||
        !Number.isFinite(high * multiplier),
    )
  ) {
    throw new RangeError(
      "Give each hour of service a finite nonnegative demand multiplier.",
    );
  }

  const itemIds = new Set<string>();
  let totalWeight = 0;
  const mix = menuMix.flatMap(({ itemId, weight }) => {
    if (
      !itemId ||
      itemIds.has(itemId) ||
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      throw new RangeError(
        "Menu mix requires unique item IDs and finite nonnegative weights.",
      );
    }
    itemIds.add(itemId);
    totalWeight += weight;
    return weight === 0 ? [] : [{ itemId, through: totalWeight }];
  });
  const finalItem = mix[mix.length - 1];
  if (!finalItem || !Number.isFinite(totalWeight)) {
    throw new RangeError("Menu mix requires a finite positive total weight.");
  }

  const runs = Array.from({ length: runCount }, (_, runIndex) => {
    const runSeed = (seed + Math.imul(runIndex, 0x9e3779b9)) >>> 0;
    const arrivalRandom = randomStream(runSeed);
    const itemRandom = randomStream(runSeed ^ 0x85ebca6b);
    const arrivals: Arrival[] = [];
    for (const [hour, multiplier] of demand.hourlyMultipliers.entries()) {
      const rate = hourlyRate * multiplier;
      if (rate === 0) continue;
      let at = hours.opensAt + hour * SECONDS_PER_HOUR;
      const end = Math.min(at + SECONDS_PER_HOUR, hours.closesAt);
      // A fresh exponential gap at each boundary yields a Poisson process with that hour's rate.
      while (true) {
        const nextAt =
          at - (Math.log1p(-arrivalRandom()) * SECONDS_PER_HOUR) / rate;
        if (nextAt >= end) break;
        if (nextAt <= at)
          throw new RangeError("Demand exceeds the clock's resolution.");
        at = nextAt;
        const selection = itemRandom() * totalWeight;
        const item =
          mix.find(({ through }) => selection < through) ?? finalItem;
        arrivals.push(
          Object.freeze({
            id: `r${runIndex + 1}-a${arrivals.length + 1}`,
            at,
            itemId: item.itemId,
          }),
        );
      }
    }
    return Object.freeze(arrivals);
  });
  return Object.freeze({ seed, demandLevel, hours, runs: Object.freeze(runs) });
}
