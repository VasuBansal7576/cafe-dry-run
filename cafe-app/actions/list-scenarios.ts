import { defineAction } from "@agent-native/core/action";
import { asc, eq } from "drizzle-orm";
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

export default defineAction({
  description:
    "List your cafe scenarios with their selected spots, spot revisions, service input revisions, tagged demand and shop inputs, and latest service run IDs. Read before editing or simulating.",
  schema: z.object({}),
  outputSchema: z.object({ scenarios: z.array(scenarioSchema) }),
  errors: scenarioErrors,
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const rows = await getDb()
      .select(scenarioFields)
      .from(scenarios)
      .where(eq(scenarios.ownerEmail, owner))
      .orderBy(asc(scenarios.id))
      .limit(100);
    return { scenarios: rows.map(toScenario) };
  },
});
