import { createHash } from "node:crypto";

import {
  DEFAULT_TOOL_RESULT_CHARS,
  defineAction,
} from "@agent-native/core/action";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { scenarios } from "../server/db/schema.js";
import {
  findScenario,
  requireOwner,
  scenarioConflict,
  scenarioErrors,
  scenarioFields,
  scenarioKey,
  scenarioSchema,
  toScenario,
  type Scenario,
} from "../server/lib/cafe/scenario-store.js";
import { fitsToolResult } from "../server/lib/cafe/tool-result-budget.js";

const scenarioIdentity = scenarioSchema.pick({
  id: true,
  revision: true,
  financeRevision: true,
});
const catalogEntry = scenarioIdentity.extend(
  scenarioSchema
    .pick({
      label: true,
      latestRunId: true,
      parentId: true,
      spotRevision: true,
    })
    .partial().shape,
);
const versionKey = z.string().regex(/^[a-f\d]{24}$/);
const catalogCursor = z.object({
  after: scenarioKey.shape.id.describe("Last entry ID from the preceding page"),
  version: versionKey.describe(
    "Unchanged catalog version from the preceding page",
  ),
});
const inputSection = z.enum([
  "identity",
  "spot",
  "demand",
  "shop",
  "finance",
  "chatFigures",
]);
const inputRequest = scenarioKey.extend({
  section: inputSection,
  path: z
    .array(z.union([z.string().max(100), z.number().int().nonnegative()]))
    .max(12)
    .optional()
    .describe(
      "Optional exact object keys and zero-based array indexes in this section",
    ),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Repeat the same section and path with nextOffset to continue a JSON text value",
    ),
  version: versionKey
    .optional()
    .describe(
      "Version from a previous input page for this exact section and path",
    ),
});
const outputSchema = z.object({
  scenarios: z.array(scenarioSchema),
  scenarioPage: z
    .object({
      entries: z.array(catalogEntry),
      version: versionKey,
      hasMore: z.boolean(),
    })
    .optional(),
  scenario: scenarioIdentity.optional(),
  inputPage: z
    .object({
      section: inputSection,
      version: versionKey,
      value: z.json().optional(),
      text: z.string().optional(),
      nextOffset: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

function versionOf(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

function budgetTooSmall(): never {
  return scenarioErrors.fail(
    "Tool result limit too small.",
    "invalid_scenario",
  );
}

function catalogConflict(): never {
  return scenarioErrors.fail(
    "Scenario list changed. Read the first page again.",
    "scenario_conflict",
    { statusCode: 409 },
  );
}

async function readCatalog(
  owner: string,
  budget: number,
  cursor?: z.infer<typeof catalogCursor>,
) {
  const {
    id,
    revision,
    financeRevision,
    label,
    latestRunId,
    parentId,
    spotRevision,
  } = scenarioFields;
  const rows = await getDb()
    .select({
      id,
      revision,
      financeRevision,
      label,
      latestRunId,
      parentId,
      spotRevision,
    })
    .from(scenarios)
    .where(eq(scenarios.ownerEmail, owner))
    .orderBy(asc(scenarios.id));
  const version = versionOf(rows);
  if (
    !fitsToolResult(
      { scenarios: [], scenarioPage: { entries: [], version, hasMore: false } },
      budget,
    )
  )
    return budgetTooSmall();
  const previousIndex = cursor
    ? rows.findIndex((row) => row.id === cursor.after)
    : -1;
  if (cursor && (cursor.version !== version || previousIndex < 0))
    return catalogConflict();

  const pageStart = previousIndex + 1;
  const entries: z.infer<typeof catalogEntry>[] = [];
  const result = (hasMore: boolean) => ({
    scenarios: [],
    scenarioPage: { entries, version, hasMore },
  });
  for (const row of rows.slice(pageStart, pageStart + 100)) {
    const hasMore = pageStart + entries.length + 1 < rows.length;
    entries.push(row);
    if (fitsToolResult(result(hasMore), budget)) continue;
    entries.pop();
    if (entries.length > 0) break;
    entries.push(scenarioIdentity.parse(row));
    if (!fitsToolResult(result(hasMore), budget)) return budgetTooSmall();
    break;
  }
  const page = result(pageStart + entries.length < rows.length);
  return fitsToolResult(page, budget) ? page : budgetTooSmall();
}

function getSection(scenario: Scenario, section: z.infer<typeof inputSection>) {
  if (section !== "identity") return scenario[section];
  const {
    id,
    label,
    revision,
    financeRevision,
    spotRevision,
    parentId,
    latestRunId,
    baseHourlyDemand,
  } = scenario;
  return {
    id,
    label,
    revision,
    financeRevision,
    spotRevision,
    parentId,
    latestRunId,
    baseHourlyDemand,
  };
}

function getPath(
  value: unknown,
  path: z.infer<typeof inputRequest>["path"],
): unknown {
  for (const key of path ?? []) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) !== (typeof key === "number") ||
      !Object.prototype.hasOwnProperty.call(value, key)
    )
      return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

async function readInput(
  owner: string,
  budget: number,
  request: z.infer<typeof inputRequest>,
) {
  const { id, section, path, offset = 0, version: expectedVersion } = request;
  if (
    !fitsToolResult(
      {
        scenarios: [],
        scenario: { id, revision: 0, financeRevision: 0 },
        inputPage: {
          section,
          version: "0".repeat(24),
          value: 0,
          nextOffset: null,
        },
      },
      budget,
    )
  )
    return budgetTooSmall();
  if (offset && !expectedVersion) return scenarioConflict();
  const scenario = await findScenario(id, owner);
  if (!scenario) {
    if (expectedVersion) return scenarioConflict();
    return scenarioErrors.fail("Scenario not found.", "scenario_not_found", {
      statusCode: 404,
    });
  }

  const identity = getSection(scenario, "identity");
  const version = versionOf([identity, section, path ?? []]);
  if (expectedVersion && expectedVersion !== version) return scenarioConflict();
  const selected = getPath(getSection(scenario, section), path);
  if (selected === undefined)
    return scenarioErrors.fail(
      "Scenario input path not found.",
      "invalid_scenario",
    );

  const value = z.json().parse(selected);
  const reference = {
    scenarios: [],
    scenario: scenarioIdentity.parse(scenario),
  };
  const complete = {
    ...reference,
    inputPage: { section, version, value, nextOffset: null },
  };
  if (!offset && fitsToolResult(complete, budget)) return complete;

  const serialized = JSON.stringify(value);
  if (offset >= serialized.length)
    return scenarioErrors.fail(
      "Scenario input offset is outside this value.",
      "invalid_scenario",
    );

  const fragment = (end: number) => ({
    scenarios: [],
    ...(offset === 0 ? { scenario: reference.scenario } : {}),
    inputPage: {
      section,
      version,
      text: serialized.slice(offset, end),
      nextOffset: end < serialized.length ? end : null,
    },
  });
  // The budget applies to the outer JSON including escapes. Check the terminal page
  // first because its null cursor can be shorter than the preceding numeric cursor.
  const final = fragment(serialized.length);
  if (fitsToolResult(final, budget)) return final;
  let low = offset + 1;
  let high = Math.min(serialized.length - 1, offset + budget);
  let fitting: ReturnType<typeof fragment> | undefined;
  while (low <= high) {
    const end = Math.floor((low + high) / 2);
    const page = fragment(end);
    if (fitsToolResult(page, budget)) {
      fitting = page;
      low = end + 1;
    } else {
      high = end - 1;
    }
  }
  return fitting ?? budgetTooSmall();
}

export default defineAction({
  description:
    "List your cafe scenarios before editing or simulating. Full scenarios include all saved inputs. A scenarioPage is a catalog only: if hasMore, call with catalog using the last entry ID and version. Read one scenario with input and a section. Prefer a specific path for a large input. An inputPage value is complete; text is a JSON fragment. Repeat the same id, section, path and version with nextOffset until null, then concatenate text before parsing. The first page carries the scenario revisions. Never use a partial value.",
  schema: z.object({
    catalog: catalogCursor.optional(),
    input: inputRequest.optional(),
  }),
  outputSchema,
  errors: scenarioErrors,
  http: { method: "GET" },
  readOnly: true,
  run: async ({ catalog, input }, ctx) => {
    const owner = requireOwner(ctx?.userEmail);
    const budget = ctx?.maxResultChars ?? DEFAULT_TOOL_RESULT_CHARS;
    if (input) {
      if (catalog)
        return scenarioErrors.fail(
          "Choose a catalog or an input read.",
          "invalid_scenario",
        );
      return readInput(owner, budget, input);
    }
    if (catalog) return readCatalog(owner, budget, catalog);

    const bounded = ctx?.maxResultChars !== undefined;
    const rows = await getDb()
      .select(scenarioFields)
      .from(scenarios)
      .where(eq(scenarios.ownerEmail, owner))
      .orderBy(asc(scenarios.id))
      .limit(bounded ? 101 : 100);
    const full = { scenarios: rows.map(toScenario) };
    if (!bounded || (rows.length <= 100 && fitsToolResult(full, budget)))
      return full;
    return readCatalog(owner, budget);
  },
});
