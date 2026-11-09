import { closeDbExec } from "@agent-native/core/db";
import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import createScenario from "../../../actions/create-scenario.js";
import listScenarios from "../../../actions/list-scenarios.js";
import { getDb } from "../../db/index.js";
import { scenarios } from "../../db/schema.js";
import migrate from "../../plugins/db.js";
import { guardCafeFigures } from "./chat-figure-guard.js";
import { configureFinance } from "./full-action-fixtures.js";

const founder = {
  userEmail: "list-budget@example.invalid",
  caller: "tool",
} as const;
const other = {
  userEmail: "list-budget-other@example.invalid",
  caller: "tool",
} as const;
const lowBudget = { ...founder, maxResultChars: 300 };

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("serves complete scoped input data with bounded owner and revision checks", async () => {
  const { scenario: a } = await createScenario.run(
    { label: "Baseline" },
    founder,
  );
  const { scenario: b } = await createScenario.run(
    { label: "Scenario 12" },
    founder,
  );
  const { scenario: foreign } = await createScenario.run(
    { label: "Private" },
    other,
  );
  const supportingValue = '"Lease" \\ 12 🥐 '.repeat(12);
  const { scenario } = await configureFinance.run(
    {
      id: b.id,
      expectedFinanceRevision: b.financeRevision,
      finance: {
        rent: {
          value: 70_000,
          source: {
            tag: "public",
            url: "https://example.invalid/" + "c".repeat(150),
            supportingValue,
            retrievedAt: "2026-11-10",
          },
        },
      },
    },
    founder,
  );

  const full = await listScenarios.run({}, founder);
  const expectedIds = [a.id, b.id].sort();
  expect(full.scenarios.map((item) => item.id)).toEqual(expectedIds);
  expect(full.scenarios.find((item) => item.id === b.id)).toEqual(scenario);

  const readCatalog = await listScenarios.run({}, lowBudget);
  if (!readCatalog.scenarioPage) throw new Error("Expected a catalog");
  const first = readCatalog.scenarioPage;
  expect(first.hasMore).toBe(true);
  expect(first.entries.map((item) => item.id)).toEqual(expectedIds.slice(0, 1));
  const catalog = { after: first.entries[0]!.id, version: first.version };
  const nextCatalog = await listScenarios.run({ catalog }, lowBudget);
  if (!nextCatalog.scenarioPage)
    throw new Error("Expected another catalog page");
  expect(nextCatalog.scenarioPage).toMatchObject({
    entries: [{ id: expectedIds[1] }],
    hasMore: false,
    version: first.version,
  });
  expect(JSON.stringify(nextCatalog, null, 2).length).toBeLessThanOrEqual(300);

  const input = {
    id: scenario.id,
    section: "finance",
    path: ["rent", "source", "supportingValue"],
  } as const;
  const read = (offset?: number, version?: string) =>
    listScenarios.run(
      { input: { ...input, path: [...input.path], offset, version } },
      lowBudget,
    );
  const firstRead = await read();
  if (!firstRead.inputPage) throw new Error("Expected an input page");
  let page = firstRead.inputPage;
  expect(page.nextOffset).not.toBeNull();
  const firstOffset = page.nextOffset!;
  const version = page.version;
  let text = "";
  for (;;) {
    if (!("text" in page)) throw new Error("Expected a JSON fragment");
    expect(page.version).toBe(version);
    text += page.text;
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBe(text.length);
    const response = await read(page.nextOffset, page.version);
    expect(JSON.stringify(response, null, 2).length).toBeLessThanOrEqual(300);
    if (!response.inputPage) throw new Error("Expected another input page");
    page = response.inputPage;
  }
  expect(JSON.parse(text)).toEqual(supportingValue.trim());
  await expect(read(firstOffset)).rejects.toThrow("changed");
  await expect(
    listScenarios.run(
      {
        input: {
          ...input,
          path: ["rent", "source", "url"],
          offset: firstOffset,
          version,
        },
      },
      lowBudget,
    ),
  ).rejects.toThrow("changed");
  await expect(
    listScenarios.run(
      { input: { id: foreign.id, section: "finance" } },
      founder,
    ),
  ).rejects.toThrow("not found");
  await expect(
    listScenarios.run({}, { ...founder, maxResultChars: 100 }),
  ).rejects.toThrow("limit too small");
  await expect(
    listScenarios.run(
      { input: { id: b.id, section: "identity", path: ["label"] } },
      { ...founder, maxResultChars: 100 },
    ),
  ).rejects.toThrow("limit too small");

  await configureFinance.run(
    {
      id: scenario.id,
      expectedFinanceRevision: scenario.financeRevision,
      finance: { rent: { value: 72_000, source: { tag: "estimate" } } },
    },
    founder,
  );
  await expect(read(firstOffset, version)).rejects.toThrow("changed");
  await expect(listScenarios.run({ catalog }, lowBudget)).rejects.toThrow(
    "changed",
  );

  const beforeDelete = await listScenarios.run(
    { input: { id: b.id, section: "identity", path: ["label"] } },
    lowBudget,
  );
  if (!beforeDelete.inputPage) throw new Error("Expected an input page");
  const latestCatalog = await listScenarios.run({}, lowBudget);
  if (!latestCatalog.scenarioPage) throw new Error("Expected a catalog");
  await getDb().delete(scenarios).where(eq(scenarios.id, b.id));
  await expect(
    listScenarios.run(
      {
        input: {
          id: b.id,
          section: "identity",
          path: ["label"],
          version: beforeDelete.inputPage.version,
        },
      },
      lowBudget,
    ),
  ).rejects.toThrow("changed");
  await expect(
    listScenarios.run(
      {
        catalog: {
          after: latestCatalog.scenarioPage.entries[0]!.id,
          version: latestCatalog.scenarioPage.version,
        },
      },
      lowBudget,
    ),
  ).rejects.toThrow("changed");
});

it("authorizes complete quote pages and retires the quote after a newer catalog observation", async () => {
  const { scenario } = await createScenario.run(
    { label: "C".repeat(50) },
    founder,
  );
  const [key, quote] = Object.entries(scenario.chatFigures!)[0]!;
  const input = {
    id: scenario.id,
    section: "chatFigures" as const,
    path: [key],
  };
  const tool = (value: unknown, toolCallId: string) => ({
    name: "list-scenarios",
    toolCallId,
    isError: false,
    content: JSON.stringify(value),
  });
  const calls: AgentLoopFinalResponseGuardContext["toolCalls"] = [];
  const results: AgentLoopFinalResponseGuardContext["toolResults"] = [];
  let version: string | undefined;
  let offset: number | undefined;
  for (;;) {
    const args = { input: { ...input, version, offset } };
    const result = await listScenarios.run(args, lowBudget);
    const toolCallId = `call_quote_${results.length}`;
    calls.push({ toolCallId, name: "list-scenarios", input: args });
    results.push(tool(result, toolCallId));
    if (!result.inputPage) throw new Error("Expected a quote page");
    if (result.inputPage.nextOffset === null) break;
    offset = result.inputPage.nextOffset;
    version = result.inputPage.version;
  }
  expect(results.length).toBeGreaterThan(1);
  const check = (toolResults = results, text = quote.text) =>
    guardCafeFigures({
      messages: [],
      assistantContent: [],
      toolCalls: calls,
      retryCount: 0,
      executionMode: "act",
      text,
      toolResults,
    });
  expect(await check(results.slice(0, -1))).toBeDefined();
  expect(await check()).toBeUndefined();
  expect(
    await check(results, "The grinder supports 999 orders."),
  ).toBeDefined();
  const latestRequest = { input: { ...input, version } };
  const conflictId = "call_read_conflict";
  calls.push({
    toolCallId: conflictId,
    name: "list-scenarios",
    input: latestRequest,
  });
  const conflict = {
    ...tool({}, conflictId),
    content:
      "Error running list-scenarios: Scenario not found or changed. (errorCode: scenario_conflict)",
    isError: true,
  };
  expect(await check([...results, conflict])).toBeDefined();

  const revised = { id: scenario.id, revision: scenario.revision + 1 };
  expect(
    await check([
      ...results,
      tool(
        { scenarios: [], scenarioPage: { entries: [revised] } },
        "call_catalog",
      ),
    ]),
  ).toBeDefined();
});
