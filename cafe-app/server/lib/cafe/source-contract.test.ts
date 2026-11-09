import {
  resolveToolMaxResultChars,
  type ActionRunContext,
} from "@agent-native/core/action";
import type { AgentEngine } from "@agent-native/core/agent/engine";
import { closeDbExec } from "@agent-native/core/db";
import {
  actionsToEngineTools,
  loadActionsFromStaticRegistry,
  runAgentLoop,
  type AgentChatEvent,
} from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import compareScenarios from "../../../actions/compare-scenarios.js";
import computeRunway from "../../../actions/compute-runway.js";
import configureFinance from "../../../actions/configure-finance.js";
import configureShop from "../../../actions/configure-shop.js";
import createScenario from "../../../actions/create-scenario.js";
import explainResult from "../../../actions/explain-result.js";
import getComparison from "../../../actions/get-comparison.js";
import getSimulation from "../../../actions/get-simulation.js";
import listScenarios from "../../../actions/list-scenarios.js";
import runSimulation from "../../../actions/run-simulation.js";
import setDemand from "../../../actions/set-demand.js";
import setPedestrianCount from "../../../actions/set-pedestrian-count.js";
import setSpot from "../../../actions/set-spot.js";
import migrate from "../../plugins/db.js";
import { guardCafeFigures } from "./chat-figure-guard.js";
import type { Scenario } from "./scenario-store.js";

const owner = {
  caller: "tool",
  userEmail: "founder@example.invalid",
} satisfies ActionRunContext;
const other = {
  caller: "tool",
  userEmail: "other@example.invalid",
} satisfies ActionRunContext;
const settings = { seed: 42, runCount: 2, demandLevel: "base" } as const;
const estimated = (value: number) => ({
  value,
  source: { tag: "estimate" as const },
});
const serviceVersion = ({ id, revision }: Scenario) => ({
  id,
  expectedRevision: revision,
});
const versions = (scenario: Scenario) => ({
  ...serviceVersion(scenario),
  expectedFinanceRevision: scenario.financeRevision,
});
const tool = (name: string, value: unknown) => ({
  name,
  isError: false,
  content: JSON.stringify(value, null, 2),
});
const check = (text: string, toolResults: ReturnType<typeof tool>[]) =>
  guardCafeFigures({
    messages: [],
    assistantContent: [],
    toolCalls: [],
    retryCount: 0,
    executionMode: "act",
    text,
    toolResults,
  });

beforeAll(() => migrate({}));
afterAll(() => closeDbExec());

it("allows exact returned map names without authorizing other numbers from the map", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const move = await setSpot.run(
    {
      id: scenario.id,
      expectedSpotRevision: scenario.spotRevision,
      location: { placeName: "12th Main & 5th Cross" },
    },
    owner,
  );
  const venue = move.map.places.find(
    ({ name }) => name === "Third Wave Coffee Roasters",
  )!;
  expect(venue).toBeDefined();
  const siteText = "I moved the pin to 12th Main & 5th Cross.";
  const venueText = "Third Wave Coffee Roasters is nearby.";
  const result = tool("set-spot", move);
  expect(await check(siteText, [result])).toBeUndefined();
  expect(await check(venueText, [result])).toBeUndefined();
  expect(await check(siteText, [{ ...result, isError: true }])).toBeDefined();

  const listed = await listScenarios.run({}, owner);
  expect(
    await check(siteText, [tool("list-scenarios", listed)]),
  ).toBeUndefined();
  expect(
    await check(venueText, [tool("list-scenarios", listed)]),
  ).toBeDefined();
  const saved = tool("list-scenarios", listed);
  const cut = saved.content.indexOf('"spotRevision"');
  expect(cut).toBeGreaterThan(0);
  expect(
    await check(siteText, [
      { ...saved, content: saved.content.slice(0, cut) + "\n\n...[truncated]" },
    ]),
  ).toBeUndefined();
  expect(
    await check(siteText, [tool("view-screen", { site: { spot: move.spot } })]),
  ).toBeUndefined();
  for (const text of [
    "I moved the pin to 12th Main & 7th Cross.",
    "I moved the pin to 6th Main & Double Road.",
    `${siteText} Expect 250 customers an hour.`,
    `${venueText} It is ${venue.distanceMetres} metres away.`,
    `${venueText} Its map ID is ${venue.osmId}.`,
    `The pin is at ${move.spot.lat}, ${move.spot.lon}.`,
  ]) {
    expect(await check(text, [result]), text).toBeDefined();
  }
  const unsupported = "250 customers an hour";
  expect(
    await check(`Expect ${unsupported}.`, [
      tool("set-spot", { ...move, spot: { ...move.spot, label: unsupported } }),
    ]),
  ).toBeDefined();
  const numbered = await setSpot.run(
    {
      id: scenario.id,
      expectedSpotRevision: move.spotRevision,
      location: { placeName: "Beginest Harbor 1" },
    },
    owner,
  );
  expect(
    await check("The pin is at Beginest Harbor 1.", [
      tool("set-spot", numbered),
    ]),
  ).toBeUndefined();
  const numberedResult = tool("set-spot", numbered);
  for (const text of [
    "It is Beginest Harbor 1 metres away.",
    "It is Beginest Harbor 1 METRES away.",
    "It is Beginest Harbor 1\u00a0metres away.",
    "It is **Beginest Harbor 1**\u202fＭＥＴＲＥＳ away.",
    "It is a Beginest Harbor 1‑metre walk.",
    "Beginest Harbor 1 drink per order.",
  ])
    expect(await check(text, [numberedResult]), text).toBeDefined();

  const secure = await setSpot.run(
    {
      id: scenario.id,
      expectedSpotRevision: numbered.spotRevision,
      location: { placeName: "56 Secure" },
    },
    owner,
  );
  const secureResult = tool("set-spot", secure);
  expect(
    await check("The pin is at 56 Secure and the coverage is partial.", [
      secureResult,
    ]),
  ).toBeUndefined();
  expect(
    await check("56 Secure Customers on Saturdays.", [secureResult]),
  ).toBeDefined();
  for (const boundary of ["\n\n", "\r\n\r\n", "\u2029"]) {
    expect(
      await check(
        `The pin is at 56 Secure${boundary}Customers can review the site map.`,
        [secureResult],
      ),
    ).toBeUndefined();
  }
  expect(
    await check("The pin is at ＋56 Secure.", [secureResult]),
  ).toBeDefined();
  expect(
    await check("The pin is at ＋ **56 Secure**.", [secureResult]),
  ).toBeDefined();
  expect(
    await check("It is Beginest Harbor 1\nmetres away.", [numberedResult]),
  ).toBeDefined();
});

it.each(["invented number", "coincidentally correct number"])(
  "clears pre-tool text with an %s and retains the real tool result",
  async (kind) => {
    const { scenario } = await createScenario.run(
      { baseHourlyDemand: 55 },
      owner,
    );
    const run = await runSimulation.run(
      { ...serviceVersion(scenario), ...settings },
      owner,
    );
    const quote = run.chatFigures.waitP50!.text;
    const actions = loadActionsFromStaticRegistry({
      "get-simulation": getSimulation,
    });
    const events: AgentChatEvent[] = [];
    let call = 0;
    const engine: AgentEngine = {
      name: "scripted-regression",
      label: "Scripted regression",
      defaultModel: "scripted-regression",
      supportedModels: ["scripted-regression"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream() {
        const text =
          ++call === 1 && kind === "invented number"
            ? "The median wait is 999 seconds. I'll check now."
            : `${quote}.`;
        yield { type: "text-delta", text };
        const part = { type: "text", text } as const;
        if (call === 1) {
          const tool = {
            type: "tool-call",
            id: "call_regression",
            name: "get-simulation",
            input: { id: scenario.id, runId: run.id, includePlayback: false },
          } as const;
          yield tool;
          yield { type: "assistant-content", parts: [part, tool] };
          yield { type: "stop", reason: "tool_use" };
        } else {
          yield { type: "assistant-content", parts: [part] };
          yield { type: "stop", reason: "end_turn" };
        }
      },
    };
    await runAgentLoop({
      actions,
      engine,
      model: engine.defaultModel,
      tools: actionsToEngineTools(actions),
      ownerEmail: owner.userEmail,
      appId: "cafe-app",
      systemPrompt: "Scripted numeric guard regression.",
      messages: [
        { role: "user", content: [{ type: "text", text: "Previous turn." }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Historical unsupported 777 seconds." },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "What is the median wait?" }],
        },
      ],
      signal: new AbortController().signal,
      send(event) {
        events.push(event);
      },
      finalResponseGuard: guardCafeFigures,
    });
    expect(call).toBe(3);
    const clears = events.filter((event) => event.type === "clear");
    expect(clears).toEqual([expect.objectContaining({ allText: true })]);
    expect(
      events
        .slice(events.indexOf(clears[0]!) + 1)
        .filter((event) => event.type === "text"),
    ).toEqual([expect.objectContaining({ text: `${quote}.` })]);
    expect(events.filter((event) => event.type === "tool_done")).toEqual([
      expect.objectContaining({
        tool: "get-simulation",
        result: expect.stringContaining(JSON.stringify(quote)),
      }),
    ]);
  },
);

it("revokes old quotes after a shared input edit while keeping quotes across unrelated variant creation", async () => {
  const { scenario: a } = await createScenario.run(
    { baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...versions(a), variantLabel: "Candidate" },
    owner,
  );
  const comparison = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...settings },
    owner,
  );
  const unrelated = await configureShop.run(
    { ...versions(a), variantLabel: "Another candidate" },
    owner,
  );
  const quote = comparison.chatFigures!["scenarioA.waitP50"]!.text;
  const prefix = [
    tool("compare-scenarios", comparison),
    tool("configure-shop", unrelated),
  ];
  expect(await check(quote, prefix)).toBeUndefined();
  expect(await check(`The grinder p90 is ${quote}.`, prefix)).toBeDefined();
  expect(await check(`- **${quote}**`, prefix)).toBeUndefined();
  const edited = await setDemand.run(
    { ...serviceVersion(a), baseHourlyDemand: 70 },
    owner,
  );
  const stale = await getComparison.run({ aId: a.id, bId: b.id }, owner);
  expect(stale.decision?.cashStale).toBe(true);
  expect(
    await check(quote, [...prefix, tool("set-demand", edited)]),
  ).toBeDefined();
  expect(
    await check(quote, [...prefix, tool("get-comparison", stale)]),
  ).toBeDefined();
  const rerun = await compareScenarios.run(
    { a: versions(edited.scenario), b: versions(b), ...settings },
    owner,
  );
  const afterRerun = [
    ...prefix,
    tool("set-demand", edited),
    tool("get-comparison", stale),
    tool("compare-scenarios", rerun),
  ];
  const currentQuote = rerun.chatFigures!["scenarioA.waitP50"]!.text;
  expect(currentQuote).not.toBe(quote);
  expect(await check(currentQuote, afterRerun)).toBeUndefined();
  expect(await check(quote, afterRerun)).toBeDefined();
  expect(
    await check("The median wait is 55 seconds.", [
      tool("list-scenarios", { scenarios: [a] }),
    ]),
  ).toBeDefined();
});

it("revokes a solo runway when a current read reveals a later service run without a revision edit", async () => {
  const { scenario } = await createScenario.run(
    { label: "Freshness test" },
    owner,
  );
  const run = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings },
    owner,
  );
  const runway = await computeRunway.run(
    { ...versions(scenario), runId: run.id },
    owner,
  );
  const cash = runway.chatFigures!["scenarioA.monthlyCash"]!.text;
  const original = tool("compute-runway", runway);
  expect(await check(cash, [original])).toBeUndefined();
  const next = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings, seed: 43 },
    owner,
  );
  const listed = await listScenarios.run({}, owner);
  expect(listed.scenarios.find(({ id }) => id === scenario.id)).toMatchObject({
    revision: scenario.revision,
    latestRunId: next.id,
  });
  expect(
    (await getComparison.run({ aId: scenario.id }, owner)).decision?.cashStale,
  ).toBe(true);
  expect(
    await check(cash, [original, tool("list-scenarios", listed)]),
  ).toBeDefined();
  const historical = await getSimulation.run(
    { id: scenario.id, runId: run.id, includePlayback: false },
    owner,
  );
  const historicalTool = tool("get-simulation", historical);
  expect(historical.run).toMatchObject({ id: run.id, stale: false });
  expect(
    historical.chatFigureBasis?.observations?.scenarios[0],
  ).not.toHaveProperty("latestRunId");
  expect(await check(cash, [original, historicalTool])).toBeUndefined();

  const current = await getSimulation.run(
    { id: scenario.id, includePlayback: false },
    owner,
  );
  const currentTool = tool("get-simulation", current);
  expect(current.run).toMatchObject({ id: next.id, stale: false });
  expect(await check(cash, [original, currentTool])).toBeDefined();
  expect(
    await check(cash, [original, currentTool, historicalTool]),
  ).toBeDefined();
  expect(
    await check(historical.chatFigures!.waitP50!.text, [
      currentTool,
      historicalTool,
    ]),
  ).toBeUndefined();
});

it("revokes earlier run quotes when a stale read observes a newer service or shared-arrival revision", async () => {
  const { scenario: baseline } = await createScenario.run(
    { label: "Original test site", baseHourlyDemand: 55 },
    owner,
  );
  const { scenario: variant } = await configureShop.run(
    { ...versions(baseline), variantLabel: "Test alternative" },
    owner,
  );
  const { scenario: separate } = await createScenario.run(
    { label: "Separate site" },
    owner,
  );
  const { scenario: separateVariant } = await configureShop.run(
    { ...versions(separate), variantLabel: "Separate alternative" },
    owner,
  );
  const unaffected = await compareScenarios.run(
    { a: versions(separate), b: versions(separateVariant), ...settings },
    owner,
  );
  const before = await runSimulation.run(
    { ...serviceVersion(baseline), ...settings },
    owner,
  );
  await runSimulation.run(
    { ...serviceVersion(baseline), ...settings, seed: 43 },
    owner,
  );
  const earlier = await getSimulation.run(
    { id: baseline.id, runId: before.id, includePlayback: false },
    owner,
  );
  const comparison = await compareScenarios.run(
    { a: versions(baseline), b: versions(variant), ...settings },
    owner,
  );
  const secondComparison = await compareScenarios.run(
    { a: versions(baseline), b: versions(variant), ...settings, seed: 43 },
    owner,
  );
  const earlierTool = tool("get-simulation", earlier);
  const earlierQuote = earlier.chatFigures!.waitP50!.text;
  expect(earlier.run?.stale).toBe(false);
  expect(await check(earlierQuote, [earlierTool])).toBeUndefined();

  await setDemand.run(
    { ...serviceVersion(baseline), baseHourlyDemand: 56 },
    owner,
  );
  const staleDefault = await getSimulation.run(
    { id: baseline.id, includePlayback: false },
    owner,
  );
  expect(staleDefault.run?.stale).toBe(true);
  expect(
    await check(earlierQuote, [
      earlierTool,
      tool("get-simulation", staleDefault),
    ]),
  ).toBeDefined();

  const stalePair = await getSimulation.run(
    {
      id: variant.id,
      runId: secondComparison.receipt.b!.service.id,
      includePlayback: false,
    },
    owner,
  );
  expect(stalePair.run?.stale).toBe(true);
  expect(stalePair.run?.scenarioRevision).toBe(variant.revision);
  const results = [
    tool("compare-scenarios", comparison),
    tool("compare-scenarios", unaffected),
    tool("get-simulation", stalePair),
  ];
  expect(
    await check(comparison.chatFigures!["scenarioB.waitP50"]!.text, results),
  ).toBeDefined();
  expect(
    await check(unaffected.chatFigures!["scenarioB.waitP50"]!.text, results),
  ).toBeUndefined();
});

it("keeps complete scenario quotes visible within Agent-Native's real list cutoff", async () => {
  const listOwner = { ...owner, userEmail: "list-cutoff@example.invalid" };
  for (let i = 0; i < 14; i++) {
    await createScenario.run(
      { label: `Survey scenario ${i}`, baseHourlyDemand: 75 },
      listOwner,
    );
  }
  const listed = await listScenarios.run({}, listOwner);
  const result = tool("list-scenarios", listed);
  const max = resolveToolMaxResultChars(listScenarios);
  expect(result.content.length).toBeGreaterThan(max);
  const clipped = result.content.slice(0, max);
  const complete = listed.scenarios.filter(({ chatFigures }) => {
    const serialized = JSON.stringify(
      chatFigures!["demand.base"],
      null,
      2,
    ).replace(/\n/g, "\n        ");
    return clipped.includes(serialized);
  });
  expect(complete.length).toBeGreaterThan(0);
  expect(complete.length).toBeLessThan(listed.scenarios.length);
  const shown = { ...result, content: clipped + "\n\n...[truncated]" };
  for (const { chatFigures } of complete) {
    expect(
      await check(`${chatFigures!["demand.base"]!.text}.`, [shown]),
    ).toBeUndefined();
  }
  const hidden = listed.scenarios.find(
    (scenario) => !complete.includes(scenario),
  )!;
  expect(
    await check(`${hidden.chatFigures!["demand.base"]!.text}.`, [shown]),
  ).toBeDefined();
  expect(await check(`Choose ${complete[0]!.label}.`, [shown])).toBeUndefined();
  expect(
    await check(`Choose ${complete[0]!.label} minutes sooner.`, [shown]),
  ).toBeDefined();
});

it.each(["finance", "service", "shared arrivals", "saved customers"] as const)(
  "revokes older paired receipts when a stale decision read observes changed %s",
  async (change) => {
    const { scenario: source } = await createScenario.run(
      { label: `${change} reference`, baseHourlyDemand: 55 },
      owner,
    );
    const variant = async (label: string) =>
      (
        await configureShop.run(
          { ...versions(source), variantLabel: `${change} ${label}` },
          owner,
        )
      ).scenario;
    const a = await variant("A");
    const b = await variant("B");
    const scope = { aId: a.id, bId: b.id };
    const older = await compareScenarios.run(
      { a: versions(a), b: versions(b), ...settings },
      owner,
    );
    const newer = await compareScenarios.run(
      { a: versions(a), b: versions(b), ...settings, seed: 43 },
      owner,
    );
    const oldTool = tool("compare-scenarios", older);
    const oldCash = older.chatFigures!["scenarioA.monthlyCash"]!.text;
    const historical = await getComparison.run(
      { ...scope, receiptId: older.receipt.id },
      owner,
    );
    expect(historical.decision).toMatchObject({
      historical: true,
      cashStale: false,
    });
    expect(
      await check(oldCash, [tool("get-comparison", historical)]),
    ).toBeUndefined();

    let arrivalRevision = source.revision;
    let otherPair: typeof older | undefined;
    if (change === "finance") {
      await configureFinance.run(
        { ...versions(a), finance: { rent: estimated(62_000) } },
        owner,
      );
    } else if (change === "service") {
      await setDemand.run(
        { ...serviceVersion(a), baseHourlyDemand: 70 },
        owner,
      );
    } else if (change === "shared arrivals") {
      arrivalRevision = (
        await setDemand.run(
          { ...serviceVersion(source), baseHourlyDemand: 70 },
          owner,
        )
      ).scenario.revision;
    } else {
      const c = await variant("C");
      otherPair = await compareScenarios.run(
        { a: versions(a), b: versions(c), ...settings },
        owner,
      );
      await compareScenarios.run(
        {
          a: versions(b),
          b: versions(a),
          ...settings,
          savedCustomers: { enabled: true, tag: "estimate" },
        },
        owner,
      );
    }

    const stale = await getComparison.run(scope, owner);
    expect(stale.decision).toMatchObject({
      cashStale: true,
      receipt: { id: newer.receipt.id },
      chatFigures: null,
    });
    const observed = stale.decision!.chatFigureBasis.observations!;
    expect(observed.scenarios).toEqual(
      expect.arrayContaining([
        {
          id: a.id,
          revision: a.revision + Number(change === "service"),
          financeRevision: a.financeRevision + Number(change === "finance"),
          latestRunId: null,
        },
        { id: source.id, revision: arrivalRevision },
      ]),
    );
    if (change === "saved customers") {
      expect(observed.assumption).toMatchObject({
        revision: (newer.receipt.assumptionRevision ?? 0) + 1,
        savedCustomers: { enabled: true, tag: "estimate" },
      });
    }
    expect(
      await getComparison.run({ ...scope, receiptId: newer.receipt.id }, other),
    ).toEqual({ decision: null, arrivalSource: null });
    const explanation = await explainResult.run(
      { ...scope, receiptId: newer.receipt.id },
      owner,
    );
    const capture = await setPedestrianCount.run(
      { id: source.id, expectedRevision: arrivalRevision, comparison: scope },
      owner,
    );
    expect(capture.requiredConversion?.kind).toBe("stale-runway");
    for (const read of [
      tool("get-comparison", stale),
      tool("explain-result", explanation),
      tool("set-pedestrian-count", capture),
    ]) {
      expect(await check(oldCash, [oldTool, read]), read.name).toBeDefined();
      if (otherPair) {
        const unrelatedDelta =
          otherPair.chatFigures!["bMinusA.monthlyCash"]!.text;
        expect(
          await check(unrelatedDelta, [
            tool("compare-scenarios", otherPair),
            read,
          ]),
          read.name,
        ).toBeUndefined();
      }
    }
  },
);

it("revokes an earlier runway when a stale decision read observes a different latest solo run", async () => {
  const { scenario } = await createScenario.run(
    { label: "Runway identity" },
    owner,
  );
  const run = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings },
    owner,
  );
  const older = await computeRunway.run(
    { ...versions(scenario), runId: run.id },
    owner,
  );
  const newer = await computeRunway.run(
    { ...versions(scenario), runId: run.id },
    owner,
  );
  const oldCash = older.chatFigures!["scenarioA.monthlyCash"]!.text;
  const oldTool = tool("compute-runway", older);
  const historical = await getComparison.run(
    { aId: scenario.id, receiptId: older.receipt.id },
    owner,
  );
  expect(historical.decision).toMatchObject({
    historical: true,
    cashStale: false,
  });
  expect(
    await check(oldCash, [tool("get-comparison", historical)]),
  ).toBeUndefined();
  const replacement = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings, seed: 43 },
    owner,
  );
  const stale = await getComparison.run({ aId: scenario.id }, owner);
  expect(stale.decision).toMatchObject({
    cashStale: true,
    receipt: { id: newer.receipt.id },
    chatFigures: null,
  });
  expect(
    stale.decision!.chatFigureBasis.observations?.scenarios,
  ).toContainEqual({
    id: scenario.id,
    revision: scenario.revision,
    financeRevision: scenario.financeRevision,
    latestRunId: replacement.id,
  });
  expect(
    await check(oldCash, [oldTool, tool("get-comparison", stale)]),
  ).toBeDefined();
});

it("returns quote-ready service and cash figures without changing the underlying receipt", async () => {
  const { scenario: a } = await createScenario.run(
    { baseHourlyDemand: 55, label: "Baseline" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    {
      ...versions(a),
      variantLabel: "Cover barista",
      shop: {
        workers: [
          ...a.shop.workers,
          { id: "cover", name: "Cover", shifts: a.shop.workers[0]!.shifts },
        ],
      },
    },
    owner,
  );
  const options = { seed: 42, runCount: 24, demandLevel: "base" as const };
  const run = await runSimulation.run(
    { ...serviceVersion(a), ...options },
    owner,
  );
  expect(run.summary.stats.waitP50Seconds).toBe(215.169523362787);
  expect(run).toMatchObject({
    chatFigures: {
      waitP50: {
        text: '"Baseline" median wait is 215.17 seconds',
        tag: "illustrative",
      },
    },
  });
  const saved = await getSimulation.run(
    { id: a.id, runId: run.id, includePlayback: false },
    owner,
  );
  expect(saved).toMatchObject({ chatFigures: run.chatFigures });

  const comparison = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...options },
    owner,
  );
  const scope = { aId: a.id, bId: b.id };
  const actionResult = [tool("compare-scenarios", comparison)];
  for (const [key, { text }] of Object.entries(comparison.chatFigures!)) {
    if (key.startsWith("bMinusA."))
      expect(text).toMatch(/^From "Baseline" to "Cover barista", /);
  }
  for (const { text } of Object.values(comparison.chatFigures!).filter(
    ({ text }) => /\d/.test(text),
  )) {
    expect(await check(`${text}.`, actionResult), text).toBeUndefined();
    expect(
      await check(`For the grinder, revenue is ${text}.`, actionResult),
      text,
    ).toBeDefined();
  }
  expect(comparison.chatFigures?.["scenarioA.waitP50"]).toEqual(
    run.chatFigures.waitP50,
  );
  expect(comparison.chatFigures?.["scenarioA.waitP90"]?.text).toBe(
    '"Baseline" p90 wait is 286.90 seconds',
  );
  expect(comparison.chatFigures?.["scenarioA.meanCustomersLost"]?.text).toBe(
    '"Baseline" averages 278.33 customers lost per Saturday',
  );
  expect(comparison.chatFigures?.["scenarioB.waitP50"]?.text).toBe(
    '"Cover barista" median wait is 96.79 seconds',
  );
  expect(comparison.chatFigures?.["scenarioB.meanOrdersServed"]?.text).toBe(
    '"Cover barista" averages 298.29 orders served per Saturday',
  );
  expect(comparison.chatFigures?.["bMinusA.monthlyCash"]?.text).toMatch(
    /^From "Baseline" to "Cover barista", projected cash flow changes by [+-]?₹[\d,.]+ per month$/,
  );
  expect((await getComparison.run(scope, owner)).decision).toEqual(comparison);
  expect(await explainResult.run(scope, owner)).toMatchObject({
    chatFigures: comparison.chatFigures,
  });
  await expect(explainResult.run(scope, other)).resolves.not.toHaveProperty(
    "chatFigures",
  );

  await configureFinance.run(
    { ...versions(a), finance: { rent: estimated(61_000) } },
    owner,
  );
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    cashStale: true,
    chatFigures: null,
  });
  expect(await explainResult.run(scope, owner)).toMatchObject({
    chatFigures: null,
  });
});

it("returns conditional no-count conversions from the saved solo runway and requires a refresh after edits", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const key = serviceVersion(scenario);
  const before = await setPedestrianCount.run(key, owner);
  expect(before.expectedSaturdayArrivals).toBeNull();
  expect(before.requiredConversion).toMatchObject({ kind: "needs-runway" });
  await expect(setPedestrianCount.run(key, other)).rejects.toThrow(
    "Scenario not found",
  );

  const run = await runSimulation.run({ ...key, ...settings }, owner);
  const { receipt } = await computeRunway.run(
    { ...versions(scenario), runId: run.id },
    owner,
  );
  const observed = await setPedestrianCount.run(key, owner);
  expect(observed.chatFigures?.["scenarioA.illustrativeCaptureRate.0"]).toEqual(
    {
      text: '"One barista" requires 30% at 100 illustrative passers-by per open day',
      tag: "illustrative",
    },
  );
  const { breakEvenOrdersPerDay, illustrativeCaptureRates } = receipt.a.cash;
  expect(breakEvenOrdersPerDay.value).toBeGreaterThan(0);
  expect(observed.requiredConversion).toEqual({
    kind: "conditional",
    receiptId: receipt.id,
    a: {
      scenarioId: scenario.id,
      breakEvenOrdersPerDay,
      illustrativeCaptureRates,
    },
    b: null,
  });
  expect(illustrativeCaptureRates).toHaveLength(3);
  for (const { passersByPerOpenDay, rate } of illustrativeCaptureRates) {
    expect(passersByPerOpenDay.tag).toBe("illustrative");
    expect(rate).toEqual({
      value: breakEvenOrdersPerDay.value! / passersByPerOpenDay.value,
      tag: "illustrative",
    });
  }
  expect(observed.scenario.revision).toBe(scenario.revision);
  await configureFinance.run(
    {
      id: scenario.id,
      expectedFinanceRevision: scenario.financeRevision,
      finance: { rent: estimated(61_000) },
    },
    owner,
  );
  expect(
    (await setPedestrianCount.run(key, owner)).requiredConversion,
  ).toMatchObject({ kind: "stale-runway" });
});

it("reads both sides of a fresh matched receipt using the shared arrival source and rejects unrelated sources", async () => {
  const { scenario: original } = await createScenario.run({}, owner);
  const { scenario: a } = await configureShop.run(
    { ...versions(original), variantLabel: "Barista" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...versions(original), variantLabel: "Grinder" },
    owner,
  );
  const comparison = { aId: a.id, bId: b.id };
  const key = serviceVersion(original);
  expect(
    (await setPedestrianCount.run({ ...key, comparison }, owner))
      .requiredConversion,
  ).toMatchObject({ kind: "needs-runway" });

  const { receipt } = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...settings },
    owner,
  );
  const result = await setPedestrianCount.run({ ...key, comparison }, owner);
  expect(result.requiredConversion).toEqual({
    kind: "conditional",
    receiptId: receipt.id,
    a: {
      scenarioId: a.id,
      breakEvenOrdersPerDay: receipt.a.cash.breakEvenOrdersPerDay,
      illustrativeCaptureRates: receipt.a.cash.illustrativeCaptureRates,
    },
    b: {
      scenarioId: b.id,
      breakEvenOrdersPerDay: receipt.b!.cash.breakEvenOrdersPerDay,
      illustrativeCaptureRates: receipt.b!.cash.illustrativeCaptureRates,
    },
  });
  await expect(
    setPedestrianCount.run({ ...serviceVersion(a), comparison }, owner),
  ).rejects.toThrow("shared arrival source");
});

it("computes matched runway from a current pair without replacing its runs", async () => {
  const { scenario: a } = await createScenario.run({}, owner);
  const { scenario: b } = await configureShop.run(
    { ...versions(a), variantLabel: "Second shop" },
    owner,
  );
  const { receipt } = await compareScenarios.run(
    { a: versions(a), b: versions(b), ...settings },
    owner,
  );
  const { scenario: cheaper } = await configureFinance.run(
    {
      id: b.id,
      expectedFinanceRevision: b.financeRevision,
      finance: { rent: estimated(b.finance.rent.value - 1_000) },
    },
    owner,
  );
  const comparison = {
    a: versions(a),
    b: versions(cheaper),
    receiptId: receipt.id,
  };
  await expect(computeRunway.run({ comparison }, other)).rejects.toThrow();
  await expect(
    computeRunway.run({ comparison: { ...comparison, b: versions(b) } }, owner),
  ).rejects.toThrow();
  await expect(
    computeRunway.run(
      { comparison: { ...comparison, a: comparison.b, b: comparison.a } },
      owner,
    ),
  ).rejects.toThrow();
  const [first, second] = await Promise.allSettled([
    computeRunway.run({ comparison }, owner),
    computeRunway.run({ comparison }, owner),
  ]);
  const winner = first.status === "fulfilled" ? first : second;
  const loser = first.status === "fulfilled" ? second : first;
  expect(winner.status).toBe("fulfilled");
  expect(loser.status).toBe("rejected");
  if (winner.status !== "fulfilled") throw winner.reason;
  const fresh = winner.value.receipt;
  expect(fresh.id).not.toBe(receipt.id);
  expect(fresh.settings).toEqual(receipt.settings);
  expect(fresh.a.service).toEqual(receipt.a.service);
  expect(fresh.b?.service).toEqual(receipt.b?.service);
  expect(fresh.weekend).toEqual(receipt.weekend);
  expect(fresh.delta?.monthlyCash.value).toBe(
    receipt.delta!.monthlyCash.value + 1_000,
  );
  expect(
    (await getComparison.run({ aId: a.id, bId: b.id }, owner)).decision,
  ).toMatchObject({ receipt: fresh, cashStale: false });
  const replayed = await compareScenarios.run(
    { a: comparison.a, b: comparison.b, ...settings },
    owner,
  );
  expect({ ...replayed.receipt, id: fresh.id }).toEqual(fresh);
  expect(winner.value.chatFigures).toEqual(replayed.chatFigures);
  expect(Object.keys(winner.value.chatFigures ?? {}).length).toBeGreaterThan(0);
});

it("uses current paired assumptions and rejects a stale service sample or obsolete switch edit", async () => {
  const { scenario: source } = await createScenario.run({}, owner);
  const { scenario: a } = await configureShop.run(
    { ...versions(source), variantLabel: "A" },
    owner,
  );
  const { scenario: b } = await configureShop.run(
    { ...versions(source), variantLabel: "B" },
    owner,
  );
  const pair = { a: versions(a), b: versions(b) };
  const forward = await compareScenarios.run({ ...pair, ...settings }, owner);
  const reverse = await compareScenarios.run(
    { a: pair.b, b: pair.a, ...settings },
    owner,
  );
  const savedCustomers = { enabled: true, tag: "estimate" as const };
  const updated = await computeRunway.run(
    {
      comparison: {
        a: pair.b,
        b: pair.a,
        receiptId: reverse.receipt.id,
        savedCustomers,
      },
    },
    owner,
  );
  expect(updated.receipt.savedCustomers).toEqual(savedCustomers);
  const comparison = { ...pair, receiptId: forward.receipt.id };
  await expect(
    computeRunway.run(
      {
        comparison: {
          ...comparison,
          savedCustomers: { ...savedCustomers, enabled: false },
        },
      },
      owner,
    ),
  ).rejects.toThrow();
  const refreshed = await computeRunway.run({ comparison }, owner);
  expect(refreshed.receipt.savedCustomers).toEqual(savedCustomers);
  expect(refreshed.receipt.a.service.id).toBe(forward.receipt.a.service.id);
  await setPedestrianCount.run(
    {
      ...serviceVersion(source),
      pedestrian: {
        count: { value: 100, source: { tag: "observed" } },
        conversionPercent: estimated(20),
      },
    },
    owner,
  );
  await expect(
    computeRunway.run(
      { comparison: { ...pair, receiptId: refreshed.receipt.id } },
      owner,
    ),
  ).rejects.toThrow();
  expect(
    (await getComparison.run({ aId: a.id, bId: b.id }, owner)).decision,
  ).toMatchObject({
    receipt: { id: refreshed.receipt.id },
    serviceStale: true,
    cashStale: true,
  });
});

it("still saves and clears observed counts without substituting an assumed count", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const pedestrian = {
    count: { value: 600, source: { tag: "observed" as const } },
    conversionPercent: estimated(10),
  };
  const observed = await setPedestrianCount.run(
    { ...serviceVersion(scenario), pedestrian },
    owner,
  );
  expect(observed).toMatchObject({
    scenario: { demand: { pedestrian } },
    expectedSaturdayArrivals: { value: 60, tag: "estimate" },
    requiredConversion: null,
  });
  expect(
    await setPedestrianCount.run(serviceVersion(observed.scenario), owner),
  ).toEqual(observed);
  await expect(
    setPedestrianCount.run(
      { ...serviceVersion(scenario), pedestrian: null },
      owner,
    ),
  ).rejects.toThrow("changed");
  const cleared = await setPedestrianCount.run(
    { ...serviceVersion(observed.scenario), pedestrian: null },
    owner,
  );
  expect(cleared).toMatchObject({
    scenario: { demand: { pedestrian: null, hourly: scenario.demand.hourly } },
    expectedSaturdayArrivals: null,
    requiredConversion: { kind: "needs-runway" },
  });
});

it("lets finance-only configure-shop edits coexist with a simultaneous service edit", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const cash = estimated(230_000);
  const patienceSeconds = estimated(120);
  await Promise.all([
    configureShop.run(
      {
        id: scenario.id,
        expectedFinanceRevision: scenario.financeRevision,
        finance: { cash },
      },
      owner,
    ),
    configureShop.run(
      { ...serviceVersion(scenario), shop: { patienceSeconds } },
      owner,
    ),
  ]);
  const read = (await listScenarios.run({}, owner)).scenarios.find(
    ({ id }) => id === scenario.id,
  );
  expect(read).toMatchObject({
    revision: scenario.revision + 1,
    financeRevision: scenario.financeRevision + 1,
    shop: { patienceSeconds },
    finance: { cash },
  });
});

it("commits combined shop and money edits atomically and rejects either stale revision", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const patienceSeconds = estimated(124);
  const cash = estimated(500_000);
  const edit = {
    ...versions(scenario),
    shop: { patienceSeconds },
    finance: { cash },
  };
  await expect(configureShop.run(edit, other)).rejects.toThrow(
    "Scenario not found",
  );
  await expect(
    configureShop.run(
      {
        ...edit,
        finance: {
          ...edit.finance,
          weekdaysPerMonth: estimated(23),
          weekendsPerMonth: estimated(10),
        },
      },
      owner,
    ),
  ).rejects.toThrow("Total open days cannot exceed 31");
  const read = async () =>
    (await listScenarios.run({}, owner)).scenarios.find(
      ({ id }) => id === scenario.id,
    );
  expect(await read()).toEqual(scenario);

  const { scenario: changed } = await configureShop.run(edit, owner);
  expect(changed).toMatchObject({
    revision: scenario.revision + 1,
    financeRevision: scenario.financeRevision + 1,
    shop: { patienceSeconds },
    finance: { cash },
  });
  await expect(
    configureShop.run({ ...edit, expectedRevision: changed.revision }, owner),
  ).rejects.toThrow("changed");
  await expect(
    configureShop.run(
      { ...edit, expectedFinanceRevision: changed.financeRevision },
      owner,
    ),
  ).rejects.toThrow("changed");
  expect(await read()).toEqual(changed);
});

it("allows only one concurrent combined edit and stales only the affected results", async () => {
  const { scenario } = await createScenario.run({}, owner);
  const run = await runSimulation.run(
    { ...serviceVersion(scenario), ...settings },
    owner,
  );
  await computeRunway.run({ ...versions(scenario), runId: run.id }, owner);
  const { scenario: moneyEdited } = await configureShop.run(
    {
      id: scenario.id,
      expectedFinanceRevision: scenario.financeRevision,
      finance: { rent: estimated(33_000) },
    },
    owner,
  );
  const scope = { aId: scenario.id };
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    serviceStale: false,
    cashStale: true,
  });
  expect(
    (await getSimulation.run({ id: scenario.id }, owner)).run,
  ).toMatchObject({ id: run.id, stale: false });

  const first = {
    shop: { patienceSeconds: estimated(99) },
    finance: { rent: estimated(34_000) },
  };
  const second = {
    shop: { patienceSeconds: estimated(101) },
    finance: { rent: estimated(35_000) },
  };
  const edits = [first, second];
  const attempts = await Promise.allSettled(
    edits.map((edit) =>
      configureShop.run({ ...versions(moneyEdited), ...edit }, owner),
    ),
  );
  expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
    reason: { message: expect.stringContaining("changed") },
  });
  const winner =
    edits[attempts.findIndex(({ status }) => status === "fulfilled")];
  const persisted = (await listScenarios.run({}, owner)).scenarios.find(
    ({ id }) => id === scenario.id,
  );
  expect(persisted).toMatchObject({
    ...winner,
    revision: moneyEdited.revision + 1,
    financeRevision: moneyEdited.financeRevision + 1,
  });
  expect((await getComparison.run(scope, owner)).decision).toMatchObject({
    serviceStale: true,
    cashStale: true,
  });
});
