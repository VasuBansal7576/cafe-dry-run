import { defineAction } from "@agent-native/core/action";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import {
  coordinateSchema,
  readScenario,
  requireOwner,
  scenarioConflict,
  scenarioErrors,
  scenarioKey,
  scenarioScope,
  spotSchema,
} from "../server/lib/cafe/scenario-store.js";
import {
  describeSpot,
  findNamedSpot,
  mapCoverage,
  placeGroupKeys,
  sameSpot,
  searchRadiusMetres,
  siteMap,
  spotAt,
  spotSourceTag,
} from "../shared/cafe/site-map.js";

const {
  name,
  sourceUrl,
  retrievedAt,
  attribution,
  attributionUrl,
  licence,
  licenceUrl,
} = siteMap;

export default defineAction({
  description:
    "Move a cafe scenario's pin by snapshot place name or coordinates. Read list-scenarios for the expected spot revision. Returns nearby places and coverage for area context only.",
  schema: scenarioKey.extend({
    expectedSpotRevision: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .describe(
        "Current spotRevision from list-scenarios. Read it again after a conflict.",
      ),
    location: z
      .union([
        coordinateSchema.strict(),
        z.object({ placeName: z.string().trim().min(1).max(200) }).strict(),
      ])
      .describe(
        "Either { lat, lon } in decimal degrees or { placeName } with a unique name in the Indiranagar map snapshot.",
      ),
  }),
  outputSchema: z.object({
    id: z.string().uuid(),
    spot: spotSchema,
    spotSourceTag: z.enum(["public", "estimate"]),
    spotRevision: z.number().int().nonnegative(),
    map: z.object({
      source: z.object({
        tag: z.literal("public"),
        name: z.string(),
        sourceUrl: z.url(),
        retrievedAt: z.iso.datetime(),
        attribution: z.string(),
        attributionUrl: z.url(),
        licence: z.string(),
        licenceUrl: z.url(),
      }),
      searchRadiusMetres: z.number().positive(),
      coverage: z.enum(mapCoverage),
      missingGroups: z.array(z.enum(placeGroupKeys)),
      places: z.array(
        coordinateSchema.extend({
          name: z.string(),
          category: z.string(),
          group: z.enum(placeGroupKeys),
          osmType: z.enum(["node", "way"]),
          osmId: z.number().int().positive(),
          distanceMetres: z.number().nonnegative(),
          distanceTag: z.enum(["public", "estimate"]),
        }),
      ),
    }),
  }),
  errors: scenarioErrors,
  run: async ({ id, expectedSpotRevision, location }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const current = await readScenario(id, owner);
    const spot =
      "placeName" in location
        ? findNamedSpot(location.placeName)
        : spotAt(location);
    if (!spot) {
      return scenarioErrors.fail(
        "No unique place matches that name in the Indiranagar snapshot. Choose a preloaded spot or supply coordinates.",
        "invalid_scenario",
      );
    }

    let spotRevision = current.spotRevision;
    if (!sameSpot(current.spot, spot)) {
      const [updated] = await getDb()
        .update(scenarios)
        .set({ spot, spotRevision: sql`${scenarios.spotRevision} + 1` })
        .where(
          and(
            scenarioScope(id, owner),
            eq(scenarios.spotRevision, expectedSpotRevision),
          ),
        )
        .returning({ spotRevision: scenarios.spotRevision });
      if (!updated) return scenarioConflict();
      spotRevision = updated.spotRevision;
    }

    const tag = spotSourceTag(spot);
    const { places, ...coverage } = describeSpot(spot);
    return {
      id,
      spot,
      spotSourceTag: tag,
      spotRevision,
      map: {
        ...coverage,
        places: places.map((place) => ({ ...place, distanceTag: tag })),
        searchRadiusMetres,
        source: {
          tag: "public" as const,
          name,
          sourceUrl,
          retrievedAt,
          attribution,
          attributionUrl,
          licence,
          licenceUrl,
        },
      },
    };
  },
});
