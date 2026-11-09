import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";

export default defineAction({
  description: "Create a cafe scenario with an illustrative base hourly demand.",
  schema: z.object({ baseHourlyDemand: z.number().int().min(0).max(1000).describe("Illustrative base customer arrivals per hour, from 0 to 1000") }),
  run: async ({ baseHourlyDemand }, ctx) => {
    const ownerEmail = ctx?.userEmail ?? fail("Sign in to create a scenario.", { statusCode: 401 });
    const [scenario] = await getDb().insert(scenarios).values({ id: crypto.randomUUID(), ownerEmail, baseHourlyDemand }).returning({ id: scenarios.id, baseHourlyDemand: scenarios.baseHourlyDemand, revision: scenarios.revision });
    return { scenario };
  },
});
