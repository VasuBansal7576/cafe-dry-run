import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";

export default defineAction({
  description: "List the current founder's cafe scenarios and their base hourly demand and revisions.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const owner = ctx?.userEmail ?? fail("Sign in to view scenarios.", { statusCode: 401 });
    return { scenarios: await getDb().select({ id: scenarios.id, baseHourlyDemand: scenarios.baseHourlyDemand, revision: scenarios.revision }).from(scenarios).where(eq(scenarios.ownerEmail, owner)).limit(100) };
  },
});
