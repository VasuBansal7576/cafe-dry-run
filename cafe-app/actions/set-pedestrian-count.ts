import {
  DEFAULT_TOOL_RESULT_CHARS,
  defineAction,
} from "@agent-native/core/action";
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
  requireScenarioWriteBudget,
  scenarioConflict,
  scenarioEditKey,
  scenarioErrors,
  scenarioSchema,
  scenarioToolSummarySchema,
  scenarioWriteMaxResultChars,
  scenarioWriteReference,
  scenarioWriteReferenceSchema,
} from "../server/lib/cafe/scenario-store.js";
import {
  pedestrianDailyArrivals,
  pedestrianSchema,
} from "../server/lib/cafe/scenario.js";
import {
  fitsToolResult,
  withoutToolResultBudget,
} from "../server/lib/cafe/tool-result-budget.js";
import setDemand from "./set-demand.js";

function conditionalRates({ service, cash }: DecisionReceipt["a"]) {
  const { breakEvenOrdersPerDay, illustrativeCaptureRates } = cash;
  return {
    scenarioId: service.scenarioId,
    breakEvenOrdersPerDay,
    illustrativeCaptureRates,
  };
}

export const pedestrianResultSchema = z.object({
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
});
const pedestrianSummarySchema = pedestrianResultSchema.extend({
  scenarioScope: z.literal("summary"),
  scenario: scenarioToolSummarySchema,
});

export default defineAction({
  description:
    "Set an observed Saturday count and conversion to derive arrivals. Send null to clear the count. Omit pedestrian to read without editing. With no count, return required break-even conversion at illustrative footfall levels from a fresh cash receipt. Quote chatFigures.text verbatim in chat. A scenarioScope of summary omits the full scenario inputs; reference confirms an edit saved without figures.",
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
  outputSchema: z.union([
    pedestrianSummarySchema,
    scenarioWriteReferenceSchema,
    pedestrianResultSchema,
  ]),
  maxResultChars: scenarioWriteMaxResultChars,
  errors: scenarioErrors,
  run: async ({ id, expectedRevision, pedestrian, comparison }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const budget = ctx?.maxResultChars;
    const writes = pedestrian !== undefined;
    if (writes) requireScenarioWriteBudget(budget);
    const finish = (result: z.infer<typeof pedestrianResultSchema>) => {
      if (
        budget === undefined ||
        fitsToolResult(result, Math.min(budget, DEFAULT_TOOL_RESULT_CHARS))
      )
        return result;
      const summary = pedestrianSummarySchema.parse({
        ...result,
        scenarioScope: "summary",
      });
      if (fitsToolResult(summary, budget)) return summary;
      if (writes) return scenarioWriteReference(result.scenario);
      return scenarioErrors.fail(
        "Tool result limit too small.",
        "invalid_scenario",
      );
    };
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
    const scenario = writes
      ? scenarioSchema.parse(
          (
            await setDemand.run(
              { id, expectedRevision, demand: { pedestrian } },
              withoutToolResultBudget(ctx),
            )
          ).scenario,
        )
      : await readScenario(id, owner);
    if (pedestrian === undefined && scenario.revision !== expectedRevision)
      return scenarioConflict();
    const count = scenario.demand.pedestrian;
    if (count) {
      const arrivals = pedestrianDailyArrivals(count);
      return finish({
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
      });
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
      return finish({
        chatFigureBasis: decisionFigureBasis(decision),
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
      });
    }
    return finish({
      chatFigureBasis: decision
        ? decision.cashStale
          ? decisionFigureBasis(decision)
          : { scenarios: [], observations: decision.quoteObservations }
        : null,
      chatFigures: null,
      ...result,
      requiredConversion: {
        kind: decision ? ("stale-runway" as const) : ("needs-runway" as const),
        message: comparison
          ? "Run compare-scenarios for the current pair before reading required conversion."
          : "Run a fresh Saturday simulation, then compute-runway before reading required conversion.",
      },
    });
  },
});
