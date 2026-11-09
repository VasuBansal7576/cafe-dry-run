import { z } from "zod";

export const playbackIdentitySchema = z.object({
  scenarioId: z.uuid(),
  runId: z.uuid(),
  receiptId: z.uuid().optional(),
  comparisonScenarioId: z.uuid().optional(),
  comparisonRunId: z.uuid().optional(),
});
export const playbackStateSchema = playbackIdentitySchema.extend({
  second: z.number().int().nonnegative(),
  seekId: z.uuid().optional(),
});

export type PlaybackIdentity = z.infer<typeof playbackIdentitySchema>;
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export function samePlayback(a: PlaybackIdentity, b: PlaybackIdentity) {
  return (
    a.scenarioId === b.scenarioId &&
    a.runId === b.runId &&
    a.receiptId === b.receiptId &&
    a.comparisonScenarioId === b.comparisonScenarioId &&
    a.comparisonRunId === b.comparisonRunId
  );
}

export function playbackBounds(
  hours: { opensAt: number; closesAt: number },
  lastEvents: readonly number[],
) {
  return {
    start: hours.opensAt,
    end: Math.ceil(Math.max(hours.closesAt, ...lastEvents)),
  };
}
