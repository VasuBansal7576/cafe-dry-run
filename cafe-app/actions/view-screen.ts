import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  readAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Read the Chat app's current navigation state. Basic navigation is already included in <current-screen>; use this action only when you need a fresh read.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "cafe"
    ) {
      const playback = await readAppStateForCurrentTab("cafe-playback");
      if (
        playback &&
        typeof playback === "object" &&
        "scenarioId" in playback &&
        "scenarioId" in navigation &&
        playback.scenarioId === navigation.scenarioId
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
