import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  playbackWriteOptions,
  playbackWriteResult,
  updatePlayback,
} from "../server/lib/cafe/playback-position.js";
import {
  requireOwner,
  scenarioErrors,
} from "../server/lib/cafe/scenario-store.js";
import {
  playbackIdentitySchema,
  playbackSpeedSchema,
} from "../shared/cafe/playback-position.js";

const controls = playbackIdentitySchema.strict().extend({
  playing: z
    .boolean()
    .optional()
    .describe(
      "True to play or replay, false to pause. Omit to keep the current play state.",
    ),
  speed: playbackSpeedSchema
    .optional()
    .describe("Playback speed multiplier. Omit to keep the current speed."),
});
const hasControl = ({ playing, speed }: z.infer<typeof controls>) =>
  playing !== undefined || speed !== undefined;

export default defineAction({
  description:
    "Play, pause, replay, or change playback speed in the current tab. Open Service test and call view-screen first. Copy its playback IDs and set historical: true only if the visible playback is marked historical. Set playing or speed only as requested by the founder.",
  schema: controls
    .extend(playbackWriteOptions)
    .refine(hasControl, "Choose play, pause, or a playback speed."),
  agentInputSchema: controls,
  outputSchema: playbackWriteResult,
  errors: scenarioErrors,
  mcpTool: false,
  changeEvents: false,
  run: (
    {
      playing,
      speed,
      observedSeekId,
      observedClockRevision,
      returnPlayback,
      effectiveAtMs,
      ...identity
    },
    ctx,
  ) =>
    updatePlayback(
      requireOwner(ctx?.userEmail),
      identity,
      { playing, speed },
      { observedSeekId, observedClockRevision, returnPlayback, effectiveAtMs },
    ),
});
