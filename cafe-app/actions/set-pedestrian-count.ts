import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  chatFigureBasisSchema,
  decisionFigureBasis,
} from "../server/lib/cafe/chat-figure-basis.js";
import {
  captureChatFigures,
  chatFiguresSchema,
  pedestrianChatFigures,
  prefixChatFigures,
} from "../server/lib/cafe/chat-figures.js";
import {
  conditionalCaptureSchema,
  type DecisionReceipt,
} from "../server/lib/cafe/decision-receipt.js";
import {
  readArrivalSource,
  readDecision,
} from "../server/lib/cafe/decision-store.js";
import { sourceTagSchema } from "../server/lib/cafe/provenance.js";
import {
  readScenario,
  requireOwner,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioSchema,
} from "../server/lib/cafe/scenario-store.js";
import {
  pedestrianDailyArrivals,
  pedestrianSchema,
} from "../server/lib/cafe/scenario.js";
import setDemand from "./set-demand.js";

function conditionalRates({ service, cash }: DecisionReceipt["a"]) {
  const { breakEvenOrdersPerDay, illustrativeCaptureRates } = cash;
  return {
    scenarioId: service.scenarioId,
    breakEvenOrdersPerDay,
    illustrativeCaptureRates,
  };
}

export default defineAction({
  description:
    "Set an observed Saturday count and conversion to derive arrivals. Send null to clear the count. Omit pedestrian to read without editing. With no count, return required break-even conversion at illustrative footfall levels from a fresh cash receipt. Quote chatFigures.text verbatim in chat.",
  schema: scenarioEditKey.extend({
    pedestrian: pedestrianSchema.nullable().optional(),
    comparison: z
      .object({
        aId: z.string().uuid(),
        bId: z.string().uuid(),
      })
      .optional()
      .describe(
        "Read conversion for a matched pair. Use the pair's shared arrival source for id and expectedRevision. Omit comparison for a solo runway.",
      ),
  }),
  outputSchema: z.object({
    chatFigureBasis: chatFigureBasisSchema.nullable(),
    chatFigures: chatFiguresSchema.nullable(),
    scenario: scenarioSchema,
    expectedSaturdayArrivals: z
      .object({ value: z.number(), tag: sourceTagSchema })
      .nullable(),
    requiredConversion: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("conditional"),
          receiptId: z.string().uuid(),
          a: conditionalCaptureSchema,
          b: conditionalCaptureSchema.nullable(),
        }),
        z.object({
          kind: z.enum(["needs-runway", "stale-runway"]),
          message: z.string(),
        }),
      ])
      .nullable(),
  }),
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, pedestrian, comparison }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    if (comparison) {
      const source = await readArrivalSource(
        owner,
        comparison.aId,
        comparison.bId,
      );
      if (!source || source.id !== id) {
        return scenarioErrors.fail(
          "Use the shared arrival source of a pair you own.",
          "invalid_scenario",
        );
      }
    }
    const scenario =
      pedestrian === undefined
        ? await readScenario(id, owner)
        : (
            await setDemand.run(
              { id, expectedRevision, demand: { pedestrian } },
              ctx,
            )
          ).scenario;
    if (pedestrian === undefined && scenario.revision !== expectedRevision)
      return scenarioConflict();
    const count = scenario.demand.pedestrian;
    if (count) {
      const arrivals = pedestrianDailyArrivals(count);
      return {
        chatFigureBasis: { scenarios: [{ id, revision: scenario.revision }] },
        chatFigures: pedestrianChatFigures(
          scenario.label,
          { value: count.count.value, tag: count.count.source.tag },
          {
            value: count.conversionPercent.value,
            tag: count.conversionPercent.source.tag,
          },
          arrivals,
        ),
        scenario,
        expectedSaturdayArrivals: arrivals,
        requiredConversion: null,
      };
    }

    const decision = await readDecision(owner, comparison ?? { aId: id });
    const result = { scenario, expectedSaturdayArrivals: null };
    if (
      decision &&
      !decision.cashStale &&
      !decision.receipt.pedestrian &&
      decision.receipt.cashBaseline?.id === id &&
      decision.receipt.cashBaseline.revision === scenario.revision
    ) {
      return {
        chatFigureBasis: decisionFigureBasis(decision.receipt),
        chatFigures: {
          ...prefixChatFigures(
            "scenarioA",
            captureChatFigures(
              decision.receipt.a.cash,
              decision.receipt.a.label,
            ),
          ),
          ...(decision.receipt.b &&
            prefixChatFigures(
              "scenarioB",
              captureChatFigures(
                decision.receipt.b.cash,
                decision.receipt.b.label,
              ),
            )),
        },
        ...result,
        requiredConversion: {
          kind: "conditional" as const,
          receiptId: decision.receipt.id,
          a: conditionalRates(decision.receipt.a),
          b: decision.receipt.b ? conditionalRates(decision.receipt.b) : null,
        },
      };
    }
    return {
      chatFigureBasis: decision?.cashStale
        ? decisionFigureBasis(decision.receipt)
        : null,
      chatFigures: null,
      ...result,
      requiredConversion: {
        kind: decision ? ("stale-runway" as const) : ("needs-runway" as const),
        message: comparison
          ? "Run compare-scenarios for the current pair before reading required conversion."
          : "Run a fresh Saturday simulation, then compute-runway before reading required conversion.",
      },
    };
  },
});
