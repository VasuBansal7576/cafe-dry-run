import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { currentPlaybackBounds } from "../server/lib/cafe/playback-position.js";
import { findScenario } from "../server/lib/cafe/scenario-store.js";
import {
  playbackFrame,
  playbackStateSchema,
} from "../shared/cafe/playback-position.js";

export default defineAction({
  description:
    "Read the current tab's view. In the café, returns the visible document and its documentHash, selected A and B, the saved site, and the displayed playback IDs, current timeline position, play state, and speed. A historical playback describes a stale result.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const navigation = await readAppStateForCurrentTab("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "cafe"
    ) {
      if (
        ctx?.userEmail &&
        "scenarioId" in navigation &&
        typeof navigation.scenarioId === "string"
      ) {
        const scenario = await findScenario(
          navigation.scenarioId,
          ctx.userEmail,
        );
        if (scenario) {
          screen.site = {
            spot: scenario.spot,
            spotRevision: scenario.spotRevision,
          };
        }
      }
      const stored = playbackStateSchema.safeParse(
        await readAppStateForCurrentTab("cafe-playback"),
      );
      const owner = ctx?.userEmail;
      if (
        owner &&
        stored.success &&
        "scenarioId" in navigation &&
        stored.data.scenarioId === navigation.scenarioId &&
        stored.data.comparisonScenarioId ===
          ("comparisonScenarioId" in navigation
            ? navigation.comparisonScenarioId
            : undefined)
      ) {
        const {
          seekId: _,
          startedAtMs: __,
          clockRevision: ___,
          commandedAtMs: ____,
          ...playback
        } = stored.data;
        const bounds = await currentPlaybackBounds(owner, playback);
        if (
          bounds &&
          playback.second >= bounds.start &&
          playback.second <= bounds.end
        ) {
          screen.playback = {
            ...playback,
            ...playbackFrame(stored.data, bounds.end, Date.now()),
          };
          if (playback.historical) screen.playbackStatus = "stale";
        }
      }
      if (!screen.playback) screen.playbackStatus = "unavailable";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
