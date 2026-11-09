import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { illustrative } from "../server/lib/cafe/provenance.js";
import {
  readScenario,
  requireOwner,
  saveScenarioInputs,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioSchema,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";
import {
  demandFields,
  demandSchema,
  hourlyRateSchema,
  serviceHourCount,
} from "../server/lib/cafe/scenario.js";

export default defineAction({
  description:
    "Edit a cafe scenario's tagged low/base/high hourly demand, Saturday opening hours, hourly curve, or observed Saturday footfall and conversion. Read list-scenarios for its expected revision.",
  schema: scenarioEditKey.extend({
    demand: demandFields
      .partial()
      .optional()
      .describe(
        "Tagged demand fields to replace. Omitted fields are preserved. If hours change and the curve is omitted, existing multipliers are retained by hour and new hours start at 1 illustrative.",
      ),
    baseHourlyDemand: hourlyRateSchema
      .optional()
      .describe(
        "Set only the base hourly demand as an illustrative value; prefer demand.hourly when replacing the range or providing provenance.",
      ),
  }),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async (
    { id, expectedRevision, demand: patch, baseHourlyDemand },
    ctx,
  ) => {
    const owner = requireOwner(ctx?.userEmail);
    if (
      (baseHourlyDemand === undefined &&
        (!patch || !Object.keys(patch).length)) ||
      (baseHourlyDemand !== undefined && patch?.hourly)
    ) {
      return scenarioErrors.fail(
        "Supply demand fields or a base demand. Use one form to edit the hourly range.",
        "invalid_scenario",
      );
    }
    const current = await readScenario(id, owner);
    if (current.revision !== expectedRevision) return scenarioConflict();
    const demand = {
      pedestrian:
        patch?.pedestrian !== undefined
          ? patch.pedestrian
          : baseHourlyDemand !== undefined || patch?.hourly
            ? null
            : current.demand.pedestrian,
      hourly: patch?.hourly ?? current.demand.hourly,
      opensAt: patch?.opensAt ?? current.demand.opensAt,
      closesAt: patch?.closesAt ?? current.demand.closesAt,
      hourlyMultipliers:
        patch?.hourlyMultipliers ?? current.demand.hourlyMultipliers,
    };
    if (baseHourlyDemand !== undefined) {
      const { low, high } = demand.hourly;
      demand.hourly = {
        low:
          low.value > baseHourlyDemand && low.source.tag === "illustrative"
            ? illustrative(baseHourlyDemand)
            : low,
        base: illustrative(baseHourlyDemand),
        high:
          high.value < baseHourlyDemand && high.source.tag === "illustrative"
            ? illustrative(baseHourlyDemand)
            : high,
      };
    }
    if (!patch?.hourlyMultipliers && (patch?.opensAt || patch?.closesAt)) {
      demand.hourlyMultipliers = Array.from(
        { length: serviceHourCount(demand) },
        (_, index) =>
          current.demand.hourlyMultipliers[index] ?? illustrative(1),
      );
    }
    const checked = validateInput(demandSchema, demand);
    return {
      scenario: await saveScenarioInputs(id, owner, expectedRevision, {
        demand: checked,
        baseHourlyDemand: checked.hourly.base.value,
      }),
    };
  },
});
