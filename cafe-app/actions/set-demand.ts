import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";

export default defineAction({
  description: "Set the illustrative base hourly customer demand for a cafe scenario using its current revision. Read list-scenarios first.",
  schema: z.object({
    id: z.string().uuid().describe("Scenario ID returned by list-scenarios"),
    baseHourlyDemand: z.number().int().min(0).max(1000).describe("Illustrative base customer arrivals per hour, from 0 to 1000"),
    expectedRevision: z.number().int().nonnegative().describe("Current revision returned by list-scenarios; read again after a conflict"),
  }),
  run: async ({ id, baseHourlyDemand, expectedRevision }, ctx) => {
    const owner = ctx?.userEmail ?? fail("Sign in to edit scenarios.", { statusCode: 401 });
    const [scenario] = await getDb().update(scenarios).set({ baseHourlyDemand, revision: sql`${scenarios.revision} + 1` }).where(and(eq(scenarios.id, id), eq(scenarios.ownerEmail, owner), eq(scenarios.revision, expectedRevision))).returning({ id: scenarios.id, baseHourlyDemand: scenarios.baseHourlyDemand, revision: scenarios.revision });
    if (!scenario) return fail("Scenario not found or changed. Read the latest scenario and try again.", { statusCode: 409, errorCode: "scenario_conflict" });
    return { scenario };
  },
});
