import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { currentPlaybackBounds } from "../server/lib/cafe/playback-position.js";
import { findScenario } from "../server/lib/cafe/scenario-store.js";
import {
  playbackFrame,
  playbackStateSchema,
} from "../shared/cafe/playback-position.js";
import {
  cafeDocuments,
  screenPaths,
  type ScreenView,
} from "../shared/screen-navigation.js";

const documentHash = z.literal([
  "",
  ...cafeDocuments.map((name) => `#${name}` as const),
]);
const scenarioIdSchema = z.uuid();
const navigationState = z.object({
  view: z.enum(Object.keys(screenPaths) as ScreenView[]),
  scenarioId: scenarioIdSchema.optional().catch(undefined),
  comparisonScenarioId: z.unknown().optional(),
  document: z.enum(cafeDocuments).optional().catch(undefined),
  hash: documentHash.optional().catch(undefined),
  threadId: z
    .string()
    .regex(/^[a-z\d_-]{1,128}$/i)
    .optional()
    .catch(undefined),
});

function screenPath(path: string) {
  return { path, publicPath: `${getConfiguredAppBasePath()}${path}` };
}

export default defineAction({
  description:
    "Read the current tab's view. In the café, returns the visible document and its documentHash, selected A and B, the saved site, and the displayed playback IDs, current timeline position, play state, and speed. A historical playback describes a stale result.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const parsed = navigationState.safeParse(
      await readAppStateForCurrentTab("navigation"),
    );
    if (!parsed.success)
      return "No application state found. Is the app running?";

    const { view, scenarioId, comparisonScenarioId, threadId, hash } =
      parsed.data;
    const owner = ctx?.userEmail;
    if (view !== "cafe") {
      if (
        view === "chat" &&
        threadId &&
        owner &&
        (await resolveAccess(
          "chat_thread",
          threadId,
          {
            userEmail: owner,
            ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
          },
          { skipResourceBody: true },
        ))
      ) {
        return {
          navigation: { view, ...screenPath(`/chat/${threadId}`), threadId },
        };
      }
      return { navigation: { view, ...screenPath(screenPaths[view]) } };
    }

    const requestedB = scenarioIdSchema.safeParse(comparisonScenarioId);
    const [scenario, comparison] =
      owner && scenarioId
        ? await Promise.all([
            findScenario(scenarioId, owner),
            requestedB.success && requestedB.data !== scenarioId
              ? findScenario(requestedB.data, owner)
              : undefined,
          ])
        : [];
    const bId = scenario && comparison?.id;
    const document = scenario ? parsed.data.document : "opening-file";
    const screen = {
      navigation: {
        view,
        ...screenPath(screenPaths.cafe),
        ...(scenario ? { scenarioId: scenario.id } : {}),
        ...(bId ? { comparisonScenarioId: bId } : {}),
        ...(document
          ? { document, documentHash: `#${document}` as const }
          : {}),
        ...(hash !== undefined ? { hash } : {}),
      },
      ...(scenario
        ? { site: { spot: scenario.spot, spotRevision: scenario.spotRevision } }
        : {}),
    };
    if (owner && scenario && (comparisonScenarioId === undefined || bId)) {
      const stored = playbackStateSchema.safeParse(
        await readAppStateForCurrentTab("cafe-playback"),
      );
      if (
        stored.success &&
        stored.data.scenarioId === scenario.id &&
        stored.data.comparisonScenarioId === bId
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
          return {
            ...screen,
            playback: {
              ...playback,
              ...playbackFrame(stored.data, bounds.end, Date.now()),
            },
            ...(playback.historical
              ? { playbackStatus: "stale" as const }
              : {}),
          };
        }
      }
    }
    return { ...screen, playbackStatus: "unavailable" as const };
  },
});
