import { defineAction } from "@agent-native/core/action";
import {
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateGetMany,
  appStateKeyForBrowserTab,
  getCurrentRequestBrowserTabId,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { currentPlaybackBounds } from "../server/lib/cafe/playback-position.js";
import {
  requireOwner,
  scenarioErrors,
} from "../server/lib/cafe/scenario-store.js";
import {
  playbackIdentitySchema,
  playbackStateSchema,
} from "../shared/cafe/playback-position.js";

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

function invalid(message: string, statusCode: 400 | 409) {
  return scenarioErrors.fail(message, "invalid_scenario", { statusCode });
}

export default defineAction({
  description:
    "Seek the current tab's fresh Saturday timeline. Open Service test and call view-screen first. Copy its scenario and run IDs, plus both paired IDs and receipt ID for a comparison, and pass the founder's requested clock time.",
  schema: seek.extend({ observedSeekId: z.uuid().nullable().optional() }),
  agentInputSchema: seek,
  outputSchema: z.object({ applied: z.boolean() }),
  errors: scenarioErrors,
  mcpTool: false,
  changeEvents: false,
  run: async ({ at, observedSeekId, ...identity }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const tab = getCurrentRequestBrowserTabId();
    if (!tab)
      return invalid("Open the café in the current browser tab to seek.", 400);
    const navKey = appStateKeyForBrowserTab("navigation", tab);
    const stateKey = appStateKeyForBrowserTab("cafe-playback", tab);
    const tabState = await appStateGetMany(owner, [navKey, stateKey]);
    const navigation = tabState[navKey];
    const stored = tabState[stateKey] ?? null;
    const browser = observedSeekId !== undefined;
    if (
      navigation?.view !== "cafe" ||
      navigation.scenarioId !== identity.scenarioId ||
      navigation.comparisonScenarioId !== identity.comparisonScenarioId ||
      (!browser && navigation.document !== "service-test")
    )
      return invalid(
        "Open the selected Saturday result in Service test before seeking.",
        409,
      );
    const bounds = await currentPlaybackBounds(owner, identity);
    if (!bounds)
      return invalid(
        "The selected Saturday is stale or has changed. Read the current screen before seeking.",
        409,
      );
    let second: number;
    if (typeof at === "number") second = at;
    else {
      const [hour = 0, minute = 0, seconds = 0] = at.split(":").map(Number);
      second = hour * 3600 + minute * 60 + seconds;
    }
    if (second < bounds.start || second > bounds.end)
      return invalid(
        "Choose a time within the selected Saturday playback.",
        400,
      );
    const parsed = playbackStateSchema.safeParse(stored);
    const currentSeekId = parsed.success ? (parsed.data.seekId ?? null) : null;
    if (browser && observedSeekId !== currentSeekId) return { applied: false };
    const seekId = browser ? currentSeekId : crypto.randomUUID();
    const position = { ...identity, second, ...(seekId ? { seekId } : {}) };
    const applied = browser
      ? await appStateCompareAndSet(owner, stateKey, stored, position, {
          requestSource: tab,
        })
      : await appStateCompareAndSetMany(
          owner,
          [
            { key: navKey, expectedValue: navigation, nextValue: navigation },
            { key: stateKey, expectedValue: stored, nextValue: position },
          ],
          { requestSource: "agent" },
        );
    if (!browser && !applied)
      return invalid(
        "The screen or timeline moved. Read the current screen and retry.",
        409,
      );
    return { applied };
  },
});
