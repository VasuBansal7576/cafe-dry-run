import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { sourceTagSchema } from "../server/lib/cafe/provenance.js";
import {
  scenarioEditKey,
  scenarioErrors,
  scenarioSchema,
} from "../server/lib/cafe/scenario-store.js";
import {
  pedestrianDailyArrivals,
  pedestrianSchema,
} from "../server/lib/cafe/scenario.js";
import setDemand from "./set-demand.js";

export default defineAction({
  description:
    "Use observed footfall for one Saturday. Set the observed count and tagged conversion together to derive Saturday arrivals, or send null to restore the hourly range. For required break-even capture use compute-runway after running Saturday service.",
  schema: scenarioEditKey.extend({ pedestrian: pedestrianSchema.nullable() }),
  outputSchema: z.object({
    scenario: scenarioSchema,
    expectedSaturdayArrivals: z
      .object({ value: z.number(), tag: sourceTagSchema })
      .nullable(),
  }),
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, pedestrian }, ctx) => ({
    ...(await setDemand.run(
      { id, expectedRevision, demand: { pedestrian } },
      ctx,
    )),
    expectedSaturdayArrivals: pedestrian
      ? pedestrianDailyArrivals(pedestrian)
      : null,
  }),
});
