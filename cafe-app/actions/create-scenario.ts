import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import {
  requireOwner,
  scenarioErrors,
  scenarioFields,
  scenarioSchema,
  toScenario,
} from "../server/lib/cafe/scenario-store.js";
import {
  defaultDemand,
  defaultShop,
  hourlyRateSchema,
} from "../server/lib/cafe/scenario.js";

export default defineAction({
  description:
    "Create a private cafe scenario with illustrative demand, Saturday hours and a one-barista shop. Edit the assumptions with set-demand and configure-shop.",
  schema: z.object({
    baseHourlyDemand: hourlyRateSchema
      .default(20)
      .describe(
        "Illustrative base customer arrivals per hour, from 0 to 1000. Defaults to 20.",
      ),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async ({ baseHourlyDemand }, ctx) => {
    const ownerEmail = requireOwner(ctx?.userEmail);
    const [row] = await getDb()
      .insert(scenarios)
      .values({
        id: crypto.randomUUID(),
        ownerEmail,
        baseHourlyDemand,
        demand: defaultDemand(baseHourlyDemand),
        shop: defaultShop(),
      })
      .returning(scenarioFields);
    return { scenario: toScenario(row!) };
  },
});
