import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { financeFields } from "../server/lib/cafe/finance.js";
import {
  scenarioErrors,
  scenarioSchema,
  scenarioFinanceEditKey,
} from "../server/lib/cafe/scenario-store.js";
import configureShop from "./configure-shop.js";

export default defineAction({
  description:
    "Edit a scenario's tagged cash, rent, wages, one-time and recurring costs, average order economics or independent weekday demand and staffing. Money edits do not invalidate Saturday playback.",
  schema: scenarioFinanceEditKey.extend({
    finance: financeFields
      .partial()
      .describe(
        "Fields to replace. Supply all three levels when replacing weekdayDemand.",
      ),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: (input, ctx) => configureShop.run(input, ctx),
});
