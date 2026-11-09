import { z } from "zod";

export const playbackIdentitySchema = z.object({
  scenarioId: z.uuid(),
  runId: z.uuid(),
  receiptId: z.uuid().optional(),
  comparisonScenarioId: z.uuid().optional(),
  comparisonRunId: z.uuid().optional(),
  historical: z.literal(true).optional(),
});
export const playbackSpeeds = [30, 120, 600] as const;
export const playbackSpeedSchema = z.literal(playbackSpeeds);
export const defaultPlaybackSpeed = 120;
export const playbackStateSchema = playbackIdentitySchema.extend({
  second: z.number().int().nonnegative(),
  seekId: z.uuid().optional(),
  clockRevision: z.number().int().nonnegative().optional(),
  commandedAtMs: z.number().int().nonnegative().optional(),
  speed: playbackSpeedSchema.optional(),
  startedAtMs: z.number().int().nonnegative().optional(),
});

export type PlaybackIdentity = z.infer<typeof playbackIdentitySchema>;
export type PlaybackState = z.infer<typeof playbackStateSchema>;
export type PlaybackChange =
  | { at: number; pause?: boolean }
  | {
      playing?: boolean | undefined;
      speed?: z.infer<typeof playbackSpeedSchema> | undefined;
    };

export type PlaybackClockCalibration = {
  offset: number;
  earliestOffset: number;
  latestOffset: number;
};
const preciseClockIntervalMs = 250;

export function precisePlaybackClock(calibration: PlaybackClockCalibration) {
  return (
    calibration.latestOffset - calibration.earliestOffset <=
    preciseClockIntervalMs
  );
}

export function calibratePlaybackClock(
  previous: PlaybackClockCalibration | undefined,
  sentAt: number,
  receivedAt: number,
  sampledAtMs: number,
): PlaybackClockCalibration {
  const earliest = sampledAtMs - receivedAt;
  const latest = sampledAtMs + 1 - sentAt;
  if (previous) {
    const earliestOffset = Math.max(previous.earliestOffset, earliest);
    const latestOffset = Math.min(previous.latestOffset, latest);
    if (earliestOffset <= latestOffset)
      return {
        offset: (earliestOffset + latestOffset) / 2,
        earliestOffset,
        latestOffset,
      };
  }
  return {
    offset: (earliest + latest) / 2,
    earliestOffset: earliest,
    latestOffset: latest,
  };
}

function samePlaybackRuns(a: PlaybackIdentity, b: PlaybackIdentity) {
  return (
    a.scenarioId === b.scenarioId &&
    a.runId === b.runId &&
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

export function initialPlaybackSecond(
  { start, end }: ReturnType<typeof playbackBounds>,
  hasEvents: boolean,
) {
  return hasEvents ? Math.min(end, start + 25 * 60) : start;
}

export function playbackFrame(state: PlaybackState, end: number, now: number) {
  const speed = state.speed ?? defaultPlaybackSpeed;
  const elapsed =
    state.startedAtMs === undefined ? 0 : Math.max(0, now - state.startedAtMs);
  const second = Math.min(
    end,
    state.second + Math.floor((elapsed * speed) / 1000),
  );
  return {
    second,
    speed,
    playing: state.startedAtMs !== undefined && second < end,
  };
}

export function restorePlayback(
  identity: PlaybackIdentity,
  saved: PlaybackState | null | undefined,
  {
    start,
    end,
    initial,
  }: ReturnType<typeof playbackBounds> & { initial: number },
  now: number,
): { state: PlaybackState; exact: boolean } {
  const sameRuns =
    saved &&
    saved.second >= start &&
    saved.second <= end &&
    samePlaybackRuns(saved, identity);
  if (!sameRuns)
    return { state: { ...identity, second: initial }, exact: false };
  const sameMode = saved.historical === identity.historical;
  if (sameMode && saved.receiptId === identity.receiptId)
    return { state: saved, exact: true };
  const { startedAtMs, speed, commandedAtMs } = saved;
  const running = sameMode && startedAtMs !== undefined;
  return {
    state: {
      ...identity,
      second: running ? saved.second : playbackFrame(saved, end, now).second,
      ...(speed !== undefined ? { speed } : {}),
      ...(running ? { startedAtMs } : {}),
      ...(running && commandedAtMs !== undefined ? { commandedAtMs } : {}),
    },
    exact: false,
  };
}

export function changePlayback(
  state: PlaybackState,
  change: PlaybackChange,
  { start, end }: ReturnType<typeof playbackBounds>,
  now: number,
): PlaybackState {
  const frame = playbackFrame(state, end, now);
  const seeking = "at" in change;
  const speed = seeking ? frame.speed : (change.speed ?? frame.speed);
  let playing = seeking
    ? frame.playing && !change.pause
    : (change.playing ?? frame.playing);
  let second = seeking ? change.at : frame.second;
  if (second === end && playing) {
    if (!seeking && change.playing === true) second = start;
    else playing = false;
  }
  const clearingAnchor =
    !seeking && change.playing === false && state.startedAtMs !== undefined;
  if (
    second === frame.second &&
    speed === frame.speed &&
    playing === frame.playing &&
    !clearingAnchor
  )
    return state;
  const { startedAtMs: _, ...paused } = state;
  return {
    ...paused,
    second,
    ...(speed === frame.speed ? {} : { speed }),
    ...(playing ? { startedAtMs: now } : {}),
  };
}
