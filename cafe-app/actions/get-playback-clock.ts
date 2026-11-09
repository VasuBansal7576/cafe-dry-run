import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readPlaybackTab } from "../server/lib/cafe/playback-position.js";
import {
  requireOwner,
  scenarioErrors,
} from "../server/lib/cafe/scenario-store.js";
import { playbackStateSchema } from "../shared/cafe/playback-position.js";

const selection = z.object({
  view: z.literal("cafe"),
  scenarioId: z.uuid(),
  comparisonScenarioId: z.uuid().optional(),
});

export default defineAction({
  description:
    "Read the café tab's saved clock and a timestamp for the browser playhead.",
  schema: z.object({}),
  outputSchema: z.object({
    selection: selection.nullable(),
    playback: playbackStateSchema.nullable(),
    sampledAtMs: z.number().int().nonnegative(),
  }),
  errors: scenarioErrors,
  http: { method: "GET" },
  mcpTool: false,
  readOnly: true,
  persistInBrowser: false,
  run: async (_args, ctx) => {
    const { navigation, stored } = await readPlaybackTab(
      requireOwner(ctx?.userEmail),
    );
    return {
      selection: selection.safeParse(navigation).data ?? null,
      playback: playbackStateSchema.safeParse(stored).data ?? null,
      sampledAtMs: Date.now(),
    };
  },
});
