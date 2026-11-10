import { defineAction } from "@agent-native/core/action";

import configureShop from "./configure-shop.js";
import {
  readScenario,
  requireOwner,
  scenarioConflict,
  scenarioErrors,
  scenarioFinanceEditKey,
  scenarioEditKey,
  scenarioWriteMaxResultChars,
  scenarioWriteOutputSchema,
} from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Create a comparison variant with one extra barista. The new worker starts with the baseline's full Saturday opening hours. The baseline and its financial inputs are unchanged.",
  schema: scenarioFinanceEditKey.extend({
    expectedRevision: scenarioEditKey.shape.expectedRevision,
  }).strict(),
  outputSchema: scenarioWriteOutputSchema,
  maxResultChars: scenarioWriteMaxResultChars,
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, expectedFinanceRevision }, ctx) => {
    const baseline = await readScenario(id, requireOwner(ctx?.userEmail));
    if (
      baseline.revision !== expectedRevision ||
      baseline.financeRevision !== expectedFinanceRevision
    ) return scenarioConflict();
    let index = 1;
    while (baseline.shop.workers.some((worker) => worker.id === `barista-${index}`)) index++;
    return configureShop.run({
      id,
      expectedRevision,
      expectedFinanceRevision,
      variantLabel: baseline.shop.workers.length === 1 ? "Two baristas" : "Extra barista",
      shop: {
        workers: [...baseline.shop.workers, {
          id: `barista-${index}`,
          name: `Barista ${index}`,
          shifts: [{ startsAt: baseline.demand.opensAt, endsAt: baseline.demand.closesAt }],
        }],
      },
    }, ctx);
  },
});
