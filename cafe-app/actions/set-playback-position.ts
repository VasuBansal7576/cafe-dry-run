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
import { playbackIdentitySchema } from "../shared/cafe/playback-position.js";

const seek = playbackIdentitySchema.strict().extend({
  at: z
    .union([
      z.number().int().nonnegative(),
      z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
    ])
    .describe(
      "Requested whole second or local clock text HH:MM[:SS]. Pass a founder-supplied clock time as written.",
    ),
});

export default defineAction({
  description:
    "Seek the current tab's Saturday timeline. Open Service test and call view-screen first. Copy its scenario and run IDs, including paired IDs and receipt ID when present. Set historical: true only if the visible playback is marked historical. Pass the founder's requested clock time.",
  schema: seek.extend({
    ...playbackWriteOptions,
    initialize: z.literal(true).optional(),
  }),
  agentInputSchema: seek,
  outputSchema: playbackWriteResult,
  errors: scenarioErrors,
  mcpTool: false,
  changeEvents: false,
  run: async (
    {
      at,
      observedSeekId,
      observedClockRevision,
      returnPlayback,
      initialize,
      effectiveAtMs,
      ...identity
    },
    ctx,
  ) => {
    let second: number;
    if (typeof at === "number") second = at;
    else {
      const [hour = 0, minute = 0, seconds = 0] = at.split(":").map(Number);
      second = hour * 3600 + minute * 60 + seconds;
    }
    return updatePlayback(
      requireOwner(ctx?.userEmail),
      identity,
      { at: second, pause: observedSeekId === undefined },
      {
        observedSeekId,
        observedClockRevision,
        returnPlayback,
        initialize,
        effectiveAtMs,
      },
    );
  },
});
