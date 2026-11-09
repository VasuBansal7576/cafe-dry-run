import { z } from "zod";

import compareAction from "../../../actions/compare-scenarios.js";
import runwayAction from "../../../actions/compute-runway.js";
import financeAction from "../../../actions/configure-finance.js";
import shopAction from "../../../actions/configure-shop.js";
import { decisionChatOutputSchema } from "./chat-figures.js";
import { scenarioSchema } from "./scenario-store.js";

function fullResult<Args extends unknown[], Result>(
  action: { run: (...args: Args) => unknown },
  schema: z.ZodType<Result>,
) {
  return {
    run: async (...args: Args) => schema.parse(await action.run(...args)),
  };
}

const scenarioOutput = z.object({ scenario: scenarioSchema });

export const compareScenarios = fullResult(
  compareAction,
  decisionChatOutputSchema,
);
export const computeRunway = fullResult(runwayAction, decisionChatOutputSchema);
export const configureFinance = fullResult(financeAction, scenarioOutput);
export const configureShop = fullResult(shopAction, scenarioOutput);
