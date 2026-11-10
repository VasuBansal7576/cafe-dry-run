import { defineAction } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import {
  financeFields,
  financeSchema,
  type ScenarioFinance,
} from "../server/lib/cafe/finance.js";
import {
  currentScenarioScope,
  readScenario,
  requireOwner,
  requireScenarioWriteBudget,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioFields,
  scenarioFinanceEditKey,
  scenarioKey,
  scenarioLabel,
  scenarioScope,
  scenarioWriteMaxResultChars,
  scenarioWriteOutputSchema,
  scenarioWriteResult,
  toScenario,
  validateInput,
  type Scenario,
} from "../server/lib/cafe/scenario-store.js";
import { shopFields, shopSchema } from "../server/lib/cafe/scenario.js";

const equipmentKinds = ["grinder", "groupHead", "steamWand"] as const;

type FinancePatch = {
  [K in keyof ScenarioFinance]?: ScenarioFinance[K] | undefined;
};
type ShopPatch = {
  [K in keyof Scenario["shop"]]?: Scenario["shop"][K] | undefined;
};

function reconcileFinance(
  current: Scenario,
  shopPatch: ShopPatch,
  patch?: FinancePatch,
) {
  const quotes =
    patch?.equipmentAdditions ?? current.finance.equipmentAdditions;
  if (quotes.length < current.finance.equipmentAdditions.length) {
    return scenarioErrors.fail(
      "Existing equipment quotes cannot be removed. Edit their amount and source instead.",
      "invalid_scenario",
    );
  }
  const addedEquipment: ScenarioFinance["unpricedEquipment"] = [];
  let remaining = [...current.finance.unpricedEquipment];
  for (const kind of equipmentKinds) {
    const difference =
      (shopPatch.equipment?.[kind].value ??
        current.shop.equipment[kind].value) -
      current.shop.equipment[kind].value;
    if (difference > 0)
      addedEquipment.push(...Array.from({ length: difference }, () => kind));
    for (let i = 0; i < -difference; i++) {
      const index = remaining.indexOf(kind);
      if (index !== -1) remaining.splice(index, 1);
    }
  }
  const requested = patch?.unpricedEquipment ?? remaining;
  const unmatched = [...remaining];
  for (const kind of requested) {
    const index = unmatched.indexOf(kind);
    if (index === -1)
      return scenarioErrors.fail(
        "Unpriced equipment cannot be relabelled. Add a quote or remove the equipment.",
        "invalid_scenario",
      );
    unmatched.splice(index, 1);
  }
  const newQuotes = quotes.length - current.finance.equipmentAdditions.length;
  if (unmatched.length > newQuotes)
    return scenarioErrors.fail(
      "Add a quote for each unpriced equipment purchase before removing it.",
      "invalid_scenario",
    );
  const quotesForNewEquipment = newQuotes - unmatched.length;
  if (
    new Set(addedEquipment).size > 1 &&
    quotesForNewEquipment > 0 &&
    quotesForNewEquipment < addedEquipment.length
  )
    return scenarioErrors.fail(
      "Add each equipment kind separately when only some new purchases have quotes, so the missing prices are identified correctly.",
      "invalid_scenario",
    );
  return validateInput(financeSchema, {
    ...current.finance,
    ...patch,
    unpricedEquipment: [
      ...requested,
      ...addedEquipment.slice(quotesForNewEquipment),
    ],
  });
}

export default defineAction({
  description:
    "Edit staff shifts, equipment, menu, service times and tagged money inputs, together or separately. A money-only edit leaves service results fresh. To create a variant without altering the original, send variantLabel and both revisions. Read list-scenarios for current revisions. Include existing workers when adding one. A scenarioScope of summary or reference confirms the scenario was saved and omits the full inputs.",
  schema: scenarioKey.extend({
    expectedRevision: scenarioEditKey.shape.expectedRevision
      .optional()
      .describe("Required when changing shop fields or copying a variant."),
    shop: shopFields
      .partial()
      .default({})
      .describe("Tagged shop fields to replace. Omitted fields are preserved."),
    variantLabel: scenarioLabel
      .optional()
      .describe(
        "Copy the scenario under this label and apply the patch to the copy only.",
      ),
    expectedFinanceRevision:
      scenarioFinanceEditKey.shape.expectedFinanceRevision
        .optional()
        .describe("Required when changing money fields or copying a variant."),
    finance: financeFields
      .partial()
      .optional()
      .describe(
        "Tagged money fields to replace on the scenario or new variant.",
      ),
    variantFinance: financeFields
      .partial()
      .optional()
      .describe(
        "Alternative to finance when copying a variant. Do not send both.",
      ),
  }),
  outputSchema: scenarioWriteOutputSchema,
  maxResultChars: scenarioWriteMaxResultChars,
  errors: scenarioErrors,
  run: async (
    {
      id,
      expectedRevision,
      shop: patch,
      variantLabel,
      expectedFinanceRevision,
      finance: financePatch,
      variantFinance,
    },
    ctx,
  ) => {
    const owner = requireOwner(ctx?.userEmail);
    requireScenarioWriteBudget(ctx?.maxResultChars);
    if (variantFinance && (!variantLabel || financePatch)) {
      return scenarioErrors.fail(
        "Use finance to edit an existing scenario. When copying a variant, send finance or variantFinance, not both.",
        "invalid_scenario",
      );
    }
    const changesShop = Object.keys(patch).length > 0;
    const changesFinance = Object.keys(financePatch ?? {}).length > 0;
    if ((variantLabel || changesShop) && expectedRevision === undefined) {
      return scenarioErrors.fail(
        "Supply the scenario revision to change shop fields or copy a variant.",
        "invalid_scenario",
      );
    }
    if (
      (variantLabel || changesFinance) &&
      expectedFinanceRevision === undefined
    ) {
      return scenarioErrors.fail(
        "Supply the financeRevision to change money fields or copy a variant.",
        "invalid_scenario",
      );
    }
    if (variantLabel && expectedRevision !== undefined) {
      const scenario = await getDb().transaction(async (tx) => {
        const [row] = await tx
          .select(scenarioFields)
          .from(scenarios)
          .where(currentScenarioScope(id, owner, expectedRevision))
          .for("update");
        if (!row || row.financeRevision !== expectedFinanceRevision)
          return scenarioConflict();
        const baseline = toScenario(row);
        const finance = reconcileFinance(
          baseline,
          patch,
          financePatch ?? variantFinance,
        );
        const [existing] = await tx
          .select({ id: scenarios.id })
          .from(scenarios)
          .where(
            and(
              eq(scenarios.ownerEmail, owner),
              eq(scenarios.parentId, id),
              eq(scenarios.label, variantLabel),
            ),
          )
          .limit(1);
        if (existing)
          return scenarioErrors.fail(
            "This baseline already has a variant with that label. Select it or choose a new label.",
            "invalid_scenario",
          );
        const [variant] = await tx
          .insert(scenarios)
          .values({
            id: crypto.randomUUID(),
            ownerEmail: owner,
            label: variantLabel,
            parentId: id,
            spot: baseline.spot,
            spotRevision: 0,
            baseHourlyDemand: baseline.baseHourlyDemand,
            demand: baseline.demand,
            shop: validateInput(shopSchema, { ...baseline.shop, ...patch }),
            finance,
          })
          .returning(scenarioFields);
        return toScenario(variant!);
      });
      return scenarioWriteResult(scenario, ctx?.maxResultChars);
    }
    if (!changesShop && !changesFinance) {
      return scenarioErrors.fail(
        "Supply a shop or money field to change, or a label to create a variant.",
        "invalid_scenario",
      );
    }
    const current = await readScenario(id, owner);
    if (
      (changesShop && current.revision !== expectedRevision) ||
      (changesFinance && current.financeRevision !== expectedFinanceRevision)
    )
      return scenarioConflict();

    const shop = changesShop
      ? validateInput(shopSchema, { ...current.shop, ...patch })
      : undefined;
    const reconciledFinance = reconcileFinance(current, patch, financePatch);
    const financeChanged =
      changesFinance ||
      JSON.stringify(reconciledFinance.unpricedEquipment) !==
        JSON.stringify(current.finance.unpricedEquipment);
    const finance = financeChanged ? reconciledFinance : undefined;
    const [row] = await getDb()
      .update(scenarios)
      .set({
        shop,
        finance,
        revision: shop ? sql`${scenarios.revision} + 1` : undefined,
        financeRevision: finance
          ? sql`${scenarios.financeRevision} + 1`
          : undefined,
      })
      .where(
        and(
          scenarioScope(id, owner),
          changesShop && expectedRevision !== undefined
            ? eq(scenarios.revision, expectedRevision)
            : undefined,
          financeChanged
            ? eq(scenarios.financeRevision, current.financeRevision)
            : undefined,
        ),
      )
      .returning(scenarioFields);
    return scenarioWriteResult(
      row ? toScenario(row) : scenarioConflict(),
      ctx?.maxResultChars,
    );
  },
});
