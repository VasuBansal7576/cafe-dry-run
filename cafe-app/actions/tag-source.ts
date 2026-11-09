import { isDeepStrictEqual } from "node:util";

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { sourceSchema, type Source } from "../server/lib/cafe/provenance.js";
import {
  readScenario,
  requireOwner,
  saveScenarioInputs,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioFinanceEditKey,
  scenarioKey,
  scenarioSchema,
  validateInput,
} from "../server/lib/cafe/scenario-store.js";
import { demandSchema, shopSchema } from "../server/lib/cafe/scenario.js";
import configureFinance from "./configure-finance.js";

const tagEdit = {
  path: z
    .string()
    .max(160)
    .regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/)
    .describe(
      "Dot-separated path within the selected section, with zero-based array positions. Examples: hourly.base, hourlyMultipliers.0, workers.0.shifts.0.startsAt, menu.0.economics.price, rent, equipmentAdditions.0.",
    ),
  source: sourceSchema.describe(
    "New provenance. A public source must include a URL, retrieval date, and supporting value.",
  ),
};

function replaceSource<T>(section: T, path: string, source: Source): T | null {
  const updated = structuredClone(section);
  let input: unknown = updated;
  for (const key of path.split(".")) {
    input =
      typeof input === "object" &&
      input !== null &&
      Object.prototype.hasOwnProperty.call(input, key)
        ? Reflect.get(input, key)
        : undefined;
  }
  if (
    typeof input !== "object" ||
    input === null ||
    !("value" in input) ||
    typeof input.value !== "number" ||
    !("source" in input)
  ) {
    return scenarioErrors.fail(
      "Choose the path of a saved tagged number from list-scenarios.",
      "invalid_scenario",
    );
  }
  if (isDeepStrictEqual(input.source, source)) return null;
  input.source = source;
  return updated;
}

export default defineAction({
  description:
    "Change the provenance of one saved numeric café scenario input without changing its value. Read list-scenarios first for the field path and revision. Use expectedRevision for demand or shop, and expectedFinanceRevision for finance. Observed pedestrian counts must remain observed.",
  schema: scenarioKey
    .extend({
      section: z.enum(["demand", "shop", "finance"]),
      expectedRevision: scenarioEditKey.shape.expectedRevision.optional(),
      expectedFinanceRevision:
        scenarioFinanceEditKey.shape.expectedFinanceRevision
          .describe(
            "Current financeRevision from list-scenarios. Supply only for finance.",
          )
          .optional(),
      ...tagEdit,
    })
    .strict()
    .refine(
      ({ section, expectedRevision, expectedFinanceRevision }) =>
        section === "finance"
          ? expectedRevision === undefined &&
            expectedFinanceRevision !== undefined
          : expectedRevision !== undefined &&
            expectedFinanceRevision === undefined,
      {
        message:
          "Use expectedRevision for demand or shop, and expectedFinanceRevision for finance.",
      },
    ),
  outputSchema: z.object({ scenario: scenarioSchema }),
  errors: scenarioErrors,
  run: async (edit, ctx) => {
    const { id, path, source, section } = edit;
    const owner = requireOwner(ctx?.userEmail);
    const current = await readScenario(id, owner);

    if (section === "finance") {
      if (current.financeRevision !== edit.expectedFinanceRevision)
        return scenarioConflict();
      const finance = replaceSource(current.finance, path, source);
      if (!finance) return { scenario: current };
      const { maxResultChars: _, ...financeContext } = ctx ?? {
        caller: "tool" as const,
        userEmail: owner,
      };
      const saved = await configureFinance.run(
        { id, expectedFinanceRevision: edit.expectedFinanceRevision, finance },
        financeContext,
      );
      return { scenario: scenarioSchema.parse(saved.scenario) };
    }

    if (current.revision !== edit.expectedRevision) return scenarioConflict();
    if (
      section === "demand" &&
      path === "pedestrian.count" &&
      source.tag !== "observed"
    ) {
      return scenarioErrors.fail(
        "A counted number of passers-by must be observed. Tag the conversion estimate separately.",
        "invalid_scenario",
      );
    }

    const changed = replaceSource(current[section], path, source);
    if (!changed) return { scenario: current };
    const patch =
      section === "demand"
        ? { demand: validateInput(demandSchema, changed) }
        : { shop: validateInput(shopSchema, changed) };
    return {
      scenario: await saveScenarioInputs(
        id,
        owner,
        edit.expectedRevision,
        patch,
      ),
    };
  },
});
