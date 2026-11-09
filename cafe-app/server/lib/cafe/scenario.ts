import { z } from "zod";

import { SECONDS_PER_DAY, type Demand, type MenuMixEntry } from "./arrivals";
import {
  illustrative,
  calculateMeasure,
  sourced,
  weakestTag,
  type Source,
  type SourceTag,
  type TaggedNumber,
} from "./provenance";
import type { Shop } from "./simulation";

export const demandLevels = ["low", "base", "high"] as const;
export const stations = ["Order", "Grind", "Brew", "Steam", "Pickup"] as const;
export const equipmentTypes = ["grinder", "groupHead", "steamWand"] as const;
export const equipmentLabels = {
  grinder: "Grinders",
  groupHead: "Group heads",
  steamWand: "Steam wands",
} as const;
export const equipmentByStation = {
  Grind: "grinder",
  Brew: "groupHead",
  Steam: "steamWand",
} as const;

export const hourlyRateSchema = z.number().int().min(0).max(1000);
const time = sourced(
  z.number().int().min(0).max(SECONDS_PER_DAY).multipleOf(60),
);
const duration = sourced(z.number().int().min(1).max(SECONDS_PER_DAY));
const equipmentCount = sourced(z.number().int().min(0).max(20));
const label = z.string().trim().min(1).max(50);
const id = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,39}$/);

export const pedestrianSchema = z.object({
  count: z
    .object({
      value: z.number().int().min(0).max(120_000),
      source: z.object({ tag: z.literal("observed") }),
    })
    .describe("People counted during one full Saturday service window"),
  conversionPercent: sourced(z.number().min(0).max(100)).describe(
    "Percent of observed Saturday passers-by expected to enter, from 0 to 100",
  ),
});

export const demandFields = z.object({
  pedestrian: pedestrianSchema
    .nullable()
    .optional()
    .describe(
      "Observed footfall and conversion for one Saturday. When present these replace the hourly range. Set to null to return to the hourly range.",
    ),
  hourly: z
    .object({
      low: sourced(hourlyRateSchema),
      base: sourced(hourlyRateSchema),
      high: sourced(hourlyRateSchema),
    })
    .describe(
      "Low, base, and high hourly customers, ordered from lowest to highest",
    ),
  opensAt: time.describe(
    "Opening time in seconds after midnight, in whole minutes",
  ),
  closesAt: time.describe(
    "Closing time in seconds after midnight, in whole minutes. 86400 means midnight at the end of Saturday",
  ),
  hourlyMultipliers: z
    .array(sourced(z.number().min(0).max(5)))
    .min(1)
    .max(24)
    .describe("One multiplier for each hour or partial hour from opening"),
});

export const demandSchema = demandFields.superRefine((value, ctx) => {
  const { low, base, high } = value.hourly;
  if (low.value > base.value || base.value > high.value) {
    ctx.addIssue({
      code: "custom",
      path: ["hourly"],
      message: "Demand must satisfy low ≤ base ≤ high.",
    });
  }
  if (value.opensAt.value >= value.closesAt.value) {
    ctx.addIssue({
      code: "custom",
      path: ["closesAt"],
      message: "Closing time must be after opening time.",
    });
  }
  if (value.hourlyMultipliers.length !== serviceHourCount(value)) {
    ctx.addIssue({
      code: "custom",
      path: ["hourlyMultipliers"],
      message: "Enter one multiplier for each hour or partial hour of service.",
    });
  }
  if (
    value.pedestrian &&
    pedestrianDailyArrivals(value.pedestrian).value > 0 &&
    value.hourlyMultipliers.every(({ value }) => value === 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["hourlyMultipliers"],
      message:
        "Set a positive curve multiplier to distribute the expected arrivals.",
    });
  }
});

const shiftSchema = z.object({ startsAt: time, endsAt: time });
const workerSchema = z.object({
  id,
  name: label,
  shifts: z.array(shiftSchema).min(1).max(8),
});
const taskSchema = z.union([
  z.object({ station: z.enum(["Order", "Pickup"]), staffSeconds: duration }),
  z.object({
    station: z.enum(["Grind", "Brew", "Steam"]),
    staffSeconds: duration,
    unattendedSeconds: sourced(z.number().int().min(0).max(SECONDS_PER_DAY)),
  }),
]);
const drinkSchema = z.object({
  id,
  name: label,
  weight: sourced(z.number().min(0).max(100)).describe(
    "Relative frequency from 0 to 100, where zero excludes this drink",
  ),
  economics: z
    .object({
      price: sourced(z.number().min(0).max(1_000_000_000)).describe(
        "Sale price for this drink in INR",
      ),
      ingredientCost: sourced(z.number().min(0).max(1_000_000_000)).describe(
        "Ingredient cost for this drink in INR",
      ),
    })
    .optional()
    .describe(
      "Tagged drink economics. Older menus without these fields use the legacy blended inputs.",
    ),
  tasks: z.array(taskSchema).min(1).max(stations.length),
});

export const shopFields = z.object({
  workers: z
    .array(workerSchema)
    .max(20)
    .describe(
      "Baristas with unique IDs and nonoverlapping shifts, in whole minutes after midnight",
    ),
  equipment: z
    .object({
      grinder: equipmentCount,
      groupHead: equipmentCount,
      steamWand: equipmentCount,
    })
    .describe("Capacity of each shared machine type"),
  menu: z
    .array(drinkSchema)
    .min(1)
    .max(12)
    .describe("Menu mix and ordered service tasks, with durations in seconds"),
  patienceSeconds: sourced(
    z.number().int().min(0).max(SECONDS_PER_DAY),
  ).describe("Maximum time a customer will wait, in seconds"),
});

export const shopSchema = shopFields.superRefine((shop, ctx) => {
  if (new Set(shop.workers.map(({ id }) => id)).size !== shop.workers.length) {
    ctx.addIssue({
      code: "custom",
      path: ["workers"],
      message: "Give each barista a unique ID.",
    });
  }
  for (const [index, worker] of shop.workers.entries()) {
    const shifts = [...worker.shifts].sort(
      (a, b) => a.startsAt.value - b.startsAt.value,
    );
    if (
      shifts.some(
        (shift, i) =>
          shift.startsAt.value >= shift.endsAt.value ||
          (i > 0 && shift.startsAt.value < shifts[i - 1]!.endsAt.value),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["workers", index, "shifts"],
        message: `${worker.name}'s shifts must end after they start and cannot overlap.`,
      });
    }
  }
  if (
    new Set(shop.menu.map(({ id }) => id)).size !== shop.menu.length ||
    !shop.menu.some(({ weight }) => weight.value > 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["menu"],
      message:
        "Give each drink a unique ID and at least one drink a positive mix weight.",
    });
  }
  for (const [index, drink] of shop.menu.entries()) {
    if (
      new Set(drink.tasks.map(({ station }) => station)).size !==
      drink.tasks.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["menu", index, "tasks"],
        message: `${drink.name} can visit each station at most once.`,
      });
    }
  }
});

export type ScenarioDemand = z.infer<typeof demandSchema>;
export type ScenarioShop = z.infer<typeof shopSchema>;

export function serviceHourCount(demand: {
  opensAt: TaggedNumber;
  closesAt: TaggedNumber;
}): number {
  return Math.max(
    0,
    Math.ceil((demand.closesAt.value - demand.opensAt.value) / 3600),
  );
}

export function defaultDemand(base: number): ScenarioDemand {
  return {
    hourly: {
      low: illustrative(Math.max(0, base - 10)),
      base: illustrative(base),
      high: illustrative(Math.min(1000, base + 20)),
    },
    opensAt: illustrative(8 * 3600),
    closesAt: illustrative(14 * 3600),
    hourlyMultipliers: Array.from({ length: 6 }, () => illustrative(1)),
  };
}

export function defaultShop(): ScenarioShop {
  const order = { station: "Order", staffSeconds: illustrative(35) } as const;
  const grind = {
    station: "Grind",
    staffSeconds: illustrative(15),
    unattendedSeconds: illustrative(0),
  } as const;
  const brew = {
    station: "Brew",
    staffSeconds: illustrative(15),
    unattendedSeconds: illustrative(25),
  } as const;
  const pickup = { station: "Pickup", staffSeconds: illustrative(15) } as const;
  return {
    workers: [
      {
        id: "barista-1",
        name: "Barista 1",
        shifts: [
          { startsAt: illustrative(8 * 3600), endsAt: illustrative(14 * 3600) },
        ],
      },
    ],
    equipment: {
      grinder: illustrative(1),
      groupHead: illustrative(1),
      steamWand: illustrative(1),
    },
    menu: [
      {
        id: "espresso",
        name: "Espresso",
        weight: illustrative(30),
        economics: {
          price: illustrative(125),
          ingredientCost: illustrative(34),
        },
        tasks: [order, grind, brew, pickup],
      },
      {
        id: "flat-white",
        name: "Flat white",
        weight: illustrative(70),
        economics: {
          price: illustrative(175),
          ingredientCost: illustrative(64),
        },
        tasks: [
          order,
          grind,
          brew,
          {
            station: "Steam",
            staffSeconds: illustrative(35),
            unattendedSeconds: illustrative(0),
          },
          pickup,
        ],
      },
    ],
    patienceSeconds: illustrative(5 * 60),
  };
}

export function arrivalInputs(
  demand: ScenarioDemand,
  shop: ScenarioShop,
): { demand: Demand; menuMix: MenuMixEntry[] } {
  const openHours = (demand.closesAt.value - demand.opensAt.value) / 3600;
  const weightedHours = demand.hourlyMultipliers.reduce(
    (sum, { value }, index) => sum + value * Math.min(1, openHours - index),
    0,
  );
  const observedHourly = demand.pedestrian
    ? weightedHours > 0
      ? pedestrianDailyArrivals(demand.pedestrian).value / weightedHours
      : 0
    : null;
  return {
    demand: {
      hours: { opensAt: demand.opensAt.value, closesAt: demand.closesAt.value },
      hourly: {
        low: observedHourly ?? demand.hourly.low.value,
        base: observedHourly ?? demand.hourly.base.value,
        high: observedHourly ?? demand.hourly.high.value,
      },
      hourlyMultipliers: demand.hourlyMultipliers.map(({ value }) => value),
    },
    menuMix: shop.menu.map(({ id, weight }) => ({
      itemId: id,
      weight: weight.value,
    })),
  };
}

export function pedestrianDailyArrivals(
  pedestrian: z.infer<typeof pedestrianSchema>,
) {
  const { count, conversionPercent } = pedestrian;
  return calculateMeasure(
    count.value * (conversionPercent.value / 100),
    count,
    conversionPercent,
  );
}

export function demandSources(
  demand: ScenarioDemand,
  level: (typeof demandLevels)[number],
): Source[] {
  return [
    ...(demand.pedestrian
      ? [
          demand.pedestrian.count.source,
          demand.pedestrian.conversionPercent.source,
        ]
      : [demand.hourly[level].source]),
    demand.opensAt.source,
    demand.closesAt.source,
    ...demand.hourlyMultipliers.map(({ source }) => source),
  ];
}

export function sampledArrivalProvenance(
  ...inputs: Parameters<typeof demandSources>
): SourceTag {
  return weakestTag(demandSources(...inputs));
}

export function serviceInputs(shop: ScenarioShop): Shop {
  return {
    workers: shop.workers.map(({ id, shifts }) => ({
      id,
      shifts: shifts.map(({ startsAt, endsAt }) => ({
        startsAt: startsAt.value,
        endsAt: endsAt.value,
      })),
    })),
    equipment: {
      grinder: shop.equipment.grinder.value,
      groupHead: shop.equipment.groupHead.value,
      steamWand: shop.equipment.steamWand.value,
    },
    menu: shop.menu.map(({ id, tasks }) => ({
      id,
      tasks: tasks.map((task) =>
        "unattendedSeconds" in task
          ? {
              id: task.station,
              staffSeconds: task.staffSeconds.value,
              machine: equipmentByStation[task.station],
              unattendedSeconds: task.unattendedSeconds.value,
            }
          : { id: task.station, staffSeconds: task.staffSeconds.value },
      ),
    })),
    patienceSeconds: shop.patienceSeconds.value,
  };
}

export function serviceWorkload(
  shop: ScenarioShop,
  arrivalMenu: ScenarioShop["menu"],
) {
  const weights = new Map(arrivalMenu.map(({ id, weight }) => [id, weight]));
  const equipmentMix: Record<keyof ScenarioShop["equipment"], Source[]> = {
    grinder: [],
    groupHead: [],
    steamWand: [],
  };
  const tasks = shop.menu.flatMap(({ id, tasks }) => {
    const weight = weights.get(id);
    if (!weight) return [];
    for (const task of tasks) {
      if ("unattendedSeconds" in task)
        equipmentMix[equipmentByStation[task.station]].push(weight.source);
    }
    return weight.value > 0 ? tasks : [];
  });
  const equipment = new Set(
    tasks.flatMap((task) =>
      "unattendedSeconds" in task ? [equipmentByStation[task.station]] : [],
    ),
  );
  return { tasks, equipment, equipmentMix };
}

export function serviceSources(
  demand: ScenarioDemand,
  shop: ScenarioShop,
  level: (typeof demandLevels)[number],
  arrivalMenu = shop.menu,
): Source[] {
  const { tasks, equipment } = serviceWorkload(shop, arrivalMenu);
  return [
    ...demandSources(demand, level),
    ...[...equipment].map((machine) => shop.equipment[machine].source),
    ...shop.workers.flatMap(({ shifts }) =>
      shifts.flatMap(({ startsAt, endsAt }) => [
        startsAt.source,
        endsAt.source,
      ]),
    ),
    ...arrivalMenu.map(({ weight }) => weight.source),
    ...tasks.flatMap((task) => [
      task.staffSeconds.source,
      ...("unattendedSeconds" in task ? [task.unattendedSeconds.source] : []),
    ]),
    shop.patienceSeconds.source,
  ];
}

export function serviceProvenance(
  ...inputs: Parameters<typeof serviceSources>
): SourceTag {
  return weakestTag(serviceSources(...inputs));
}
