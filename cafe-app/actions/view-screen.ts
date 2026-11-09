import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

import { findScenario } from "../server/lib/cafe/scenario-store.js";

export default defineAction({
  description:
    "Read the current tab's view. In the café, returns the active document hash, selected A and B, the saved site and the displayed run IDs and timeline position.",
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
      const playback = await readAppStateForCurrentTab("cafe-playback");
      if (
        playback &&
        typeof playback === "object" &&
        "scenarioId" in playback &&
        "scenarioId" in navigation &&
        playback.scenarioId === navigation.scenarioId &&
        ("comparisonScenarioId" in playback
          ? playback.comparisonScenarioId
          : undefined) ===
          ("comparisonScenarioId" in navigation
            ? navigation.comparisonScenarioId
            : undefined)
      ) {
        screen.playback = playback;
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
