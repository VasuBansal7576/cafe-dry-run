import { z } from "zod";

import { sourceTagSchema } from "./provenance";
import { demandLevels, equipmentTypes, stations } from "./scenario";

export const serviceParameters = z.object({
  seed: z
    .number()
    .int()
    .min(0)
    .max(0xffff_ffff)
    .default(42)
    .describe("Unsigned 32-bit random seed. Defaults to 42."),
  demandLevel: z
    .enum(demandLevels)
    .default("base")
    .describe(
      "Which hourly demand to simulate: low, base or high. Defaults to base.",
    ),
  runCount: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(24)
    .describe(
      "Number of seeded Saturdays from 1 to 100. Defaults to 24. The first Saturday is saved for playback.",
    ),
});

const seconds = z.number().nonnegative();
const count = z.number().int().nonnegative();
const name = z.string().min(1);
const station = z.enum(stations);
const eventBase = z.object({ at: seconds, arrivalId: name });
const event = z.discriminatedUnion("kind", [
  eventBase.extend({ kind: z.literal("arrived"), itemId: name }),
  eventBase.extend({ kind: z.literal("task_queued"), taskId: station }),
  eventBase.extend({ kind: z.literal("task_completed"), taskId: station }),
  eventBase.extend({
    kind: z.literal("task_started"),
    taskId: station,
    workerId: name,
    workerReleasedAt: seconds,
    endsAt: seconds,
    machineId: name.optional(),
  }),
  eventBase.extend({ kind: z.literal("order_served"), waitSeconds: seconds }),
  eventBase.extend({ kind: z.literal("customer_lost"), waitSeconds: seconds }),
]);
const wait = z.object({
  resource: z.enum(["staff", ...equipmentTypes]),
  label: name,
  blockedTasks: count,
  totalWaitSeconds: seconds,
  longestTaskWaitSeconds: seconds,
});
const stats = z.object({
  waitP50Seconds: seconds.nullable(),
  waitP90Seconds: seconds.nullable(),
  utilization: z.array(
    z.object({
      id: name,
      kind: z.enum(["worker", ...equipmentTypes]),
      busySeconds: seconds,
      availableSeconds: seconds,
      fraction: z.number().min(0).max(1),
    }),
  ),
  resourceWaits: z.array(wait),
  bottleneck: wait.nullable(),
});

export const serviceSummarySchema = serviceParameters.extend({
  provenance: sourceTagSchema,
  arrivalProvenance: sourceTagSchema.optional(),
  hours: z.object({ opensAt: seconds, closesAt: seconds }),
  staffNames: z.record(z.string(), name),
  itemNames: z.record(z.string(), name),
  stats: stats.extend({
    utilization: stats.shape.utilization.element
      .extend({ fractionProvenance: sourceTagSchema.optional() })
      .array(),
    meanOrdersServed: seconds,
    meanCustomersLost: seconds,
  }),
});
const playbackCapacitySchema = z.object({
  workers: z.array(
    z.object({
      id: name,
      shifts: z.array(z.object({ startsAt: seconds, endsAt: seconds })),
    }),
  ),
  equipment: z.record(z.enum(equipmentTypes), count),
  tasks: z.record(
    name,
    z.record(
      name,
      z.object({
        staffSeconds: seconds.positive(),
        machine: z.enum(equipmentTypes).optional(),
      }),
    ),
  ),
});

export const servicePlaybackSchema = z.object({
  capacity: playbackCapacitySchema.optional(),
  arrivals: z.array(z.object({ id: name, at: seconds, itemId: name })),
  timeline: z.array(event),
  stats: stats.extend({ ordersServed: count, customersLost: count }),
});
export const serviceRunSchema = z.object({
  id: z.string().uuid(),
  scenarioId: z.string().uuid(),
  scenarioRevision: count,
  arrivalSource: z
    .object({ id: z.string().uuid(), revision: count })
    .optional(),
  summary: serviceSummarySchema,
  playback: servicePlaybackSchema,
});
export type ServiceRun = z.infer<typeof serviceRunSchema>;
