import type { ActionRunContext } from "@agent-native/core/action";
import { closeDbExec } from "@agent-native/core/db";
import { appendAgentChatContextToMessage } from "@agent-native/core/shared";
import { afterAll, beforeAll, expect, it } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import {
  COMPARISON_REVIEW_CONTEXT,
  COMPARISON_REVIEW_PROMPT,
} from "../../../shared/cafe/structured-review.js";
import migrate from "../../plugins/db.js";
import {
  compareScenarios,
  configureFinance,
  configureShop,
} from "./full-action-fixtures.js";
import { illustrative } from "./provenance.js";
import type { Scenario } from "./scenario-store.js";
import {
  comparisonReviewRequest,
  readReviewEvidence,
  reviewInputSchema,
} from "./structured-review.js";

const owner = {
  caller: "tool",
  userEmail: "owner@example.invalid",
} satisfies ActionRunContext;
const version = ({ id, revision, financeRevision }: Scenario) => ({
  id,
  expectedRevision: revision,
  expectedFinanceRevision: financeRevision,
});

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("returns aliased quotes only for the current ordered pair belonging to the owner", async () => {
  const { scenario: a } = await createScenario.run(
    { label: "Untrusted 999-minute name", baseHourlyDemand: 60 },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    {
      ...version(a),
      variantLabel: "Extra grinder",
      shop: { equipment: { ...a.shop.equipment, grinder: illustrative(2) } },
    },
    owner,
  );
  const input = {
    a: version(a),
    b: version(b),
    seed: 42,
    runCount: 2,
    demandLevel: "base" as const,
  };
  const first = await compareScenarios.run(input, owner);
  const scope = {
    kind: "cafe-comparison-review" as const,
    aId: a.id,
    bId: b.id,
    receiptId: first.receipt.id,
  };
  const evidence = await readReviewEvidence(owner.userEmail, scope);
  expect(evidence?.receiptId).toBe(first.receipt.id);
  expect(evidence?.labels).toEqual({
    a: "Scenario A",
    b: "Scenario B (Extra grinder)",
  });
  expect(evidence?.figures["scenarioA.waitP50"]?.text).toContain("Scenario A");
  expect(JSON.stringify(evidence)).not.toContain("999-minute");
  expect(await readReviewEvidence("other@example.invalid", scope)).toBeNull();
  expect(
    await readReviewEvidence(owner.userEmail, {
      ...scope,
      aId: b.id,
      bId: a.id,
    }),
  ).toBeNull();

  const second = await compareScenarios.run({ ...input, seed: 43 }, owner);
  expect(await readReviewEvidence(owner.userEmail, scope)).toBeNull();
  const current = { ...scope, receiptId: second.receipt.id };
  expect(await readReviewEvidence(owner.userEmail, current)).not.toBeNull();
  await configureFinance.run(
    {
      id: a.id,
      expectedFinanceRevision: a.financeRevision,
      finance: { rent: illustrative(49_000) },
    },
    owner,
  );
  expect(await readReviewEvidence(owner.userEmail, current)).toBeNull();
});

it("rejects free-form prose in model recommendation arguments", () => {
  expect(
    reviewInputSchema.safeParse({
      operation: "recommend",
      choice: "b-for-cash",
      reason: "The grinder saves 999 seconds",
    }).success,
  ).toBe(false);
  expect(
    reviewInputSchema.safeParse({
      operation: "recommend",
      choice: "Scenario B saves 999 seconds",
    }).success,
  ).toBe(false);
  expect(
    reviewInputSchema.safeParse({
      operation: "recommend",
      choice: "b-for-cash",
    }).success,
  ).toBe(true);
});

it("recovers the exact Explain scope without inheriting it into an ordinary follow-up", () => {
  const scope = {
    kind: "cafe-comparison-review",
    aId: "7ef49d3f-7ae5-4b45-a32b-61a1133d0fe4",
    bId: "c187a816-8bd4-45e5-9f68-d02ce1278192",
    receiptId: "c079b686-4a7f-4f17-a199-85d86ac526fb",
  };
  const context = COMPARISON_REVIEW_CONTEXT + JSON.stringify(scope);
  expect(
    comparisonReviewRequest(
      appendAgentChatContextToMessage(COMPARISON_REVIEW_PROMPT, context),
    ),
  ).toEqual(scope);
  expect(
    comparisonReviewRequest(
      appendAgentChatContextToMessage("What about staffing?", context),
    ),
  ).toBeUndefined();
  expect(comparisonReviewRequest(COMPARISON_REVIEW_PROMPT)).toBeNull();
});
