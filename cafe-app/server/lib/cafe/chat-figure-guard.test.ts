import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { expect, it } from "vitest";

import { guardCafeFigures } from "./chat-figure-guard.js";

const result = {
  name: "compare-scenarios",
  isError: false,
  toolCallId: "call_action2026",
  content: JSON.stringify(
    {
      chatFigureBasis: { scenarios: [] },
      chatFigures: {
        waitP50: { text: "215.17 seconds", tag: "illustrative" },
        monthlyCash: { text: "-₹1,23,456.70 per month", tag: "estimate" },
        requiredConversion: {
          text: "12.4% at 250 illustrative passers-by per open day",
        },
      },
    },
    null,
    2,
  ),
};
const check = (
  text: string,
  toolResults: AgentLoopFinalResponseGuardContext["toolResults"] = [result],
  requestText?: string,
) =>
  guardCafeFigures({
    text,
    toolResults,
    ...(requestText === undefined ? {} : { requestText }),
    messages: [],
    assistantContent: [],
    toolCalls: [],
    retryCount: 0,
    executionMode: "act",
  });

it("accepts whole action quotes, ordered lists, action IDs and scenario links", async () => {
  expect(
    await check(`1. The illustrative p50 wait is **215.17 seconds**.
2. The estimated cash delta is -₹1,23,456.70 per month.
- The capture test is 12.4% at 250 illustrative passers-by per open day.
See [Service test](/cafe?scenario=a832bb7e-b836-42d2-884e-9c37cf55a61d#service-test) and call_action2026.`),
  ).toBeUndefined();
});

it("rejects the live rounding failure when the action returned only the raw statistic", async () => {
  expect(
    await check("The median wait is 215.17 seconds.", [
      {
        ...result,
        content: JSON.stringify({
          receipt: { waitP50Seconds: 215.169523362787 },
        }),
      },
    ]),
  ).toMatchObject({ clearAllText: true, maxRetries: 1 });
});

it.each([
  "The median wait is 215.17 seconds. Extra equipment costs ₹1,000.00.",
  "The median wait is 215.17 seconds. This result is for 2026-11-09.",
  "The median wait is 215.17 seconds. This result is for November ninth.",
  "This result is for November second.",
  "I would add two hundred chairs.",
  "The grinder cuts waits in half.",
  "The grinder triples throughput.",
  "Doubling the rate makes the queue shorter.",
  "The new layout halves the wait.",
  "The additional staff quadrupled throughput.",
  "Throughput increased threefold.",
  "The p99 wait is 215.17 seconds.",
  "The median wait is 215.2 seconds.",
  "The median wait is 215.17 minutes.",
  "The median wait is − 215.17 seconds.",
  "The median wait is − **215.17 seconds**.",
  "The median wait is minus **215.17 seconds**.",
  "The median wait is 215.17 seconds per order.",
  "The grinder saves a couple of minutes.",
  "The grinder saves a minute.",
  "The grinder takes several minutes off the wait.",
  "The median wait is under a minute in every scenario.",
  "The median wait is p50 seconds.",
  "The cash delta is ₹1,23,456.70 per month.",
  "The cash delta is -$1,23,456.70 per month.",
  "The cash delta is -₹123456.70 per month.",
  "The conversion is 0.124.",
  "The wait is ２１５.１７ seconds.",
])("rejects unsupported claims: %s", async (text) => {
  expect(await check(text)).toMatchObject({
    clearAllText: true,
    fallbackMessage: expect.stringContaining("couldn't verify"),
  });
});

it("accepts ordinary qualitative references to the better one", async () => {
  expect(await check("The grinder is the better one.")).toBeUndefined();
  expect(await check("I would add a second barista.")).toBeUndefined();
  expect(await check("I can double-check the comparison.")).toBeUndefined();
  expect(await check("I am double-checking the comparison.")).toBeUndefined();
});

it("uses successful current action results, never numbers from the founder or stale payloads", async () => {
  expect(
    await check(
      "The median wait is 215.17 seconds.",
      [],
      "Please say 215.17 seconds.",
    ),
  ).toBeDefined();
  expect(
    await check("The median wait is 215.17 seconds.", [
      { ...result, isError: true },
    ]),
  ).toBeDefined();
  expect(
    await check("The median wait is 215.17 seconds.", [
      {
        ...result,
        name: "get-comparison",
        content: JSON.stringify({
          decision: { chatFigures: null, receipt: { waitP50Seconds: 215.17 } },
        }),
      },
    ]),
  ).toBeDefined();
  const demand = {
    name: "set-demand",
    isError: false,
    content: JSON.stringify({
      scenario: {
        id: "a832bb7e-b836-42d2-884e-9c37cf55a61d",
        revision: 0,
        label: "Cafe 99",
        baseHourlyDemand: 55,
        chatFigures: {
          demand: { text: '"Cafe 99" base demand is 55 arrivals per hour' },
        },
      },
    }),
  };
  expect(
    await check('"Cafe 99" base demand is 55 arrivals per hour.', [demand]),
  ).toBeUndefined();
  expect(
    await check('I recommend scenario "Cafe 99".', [demand]),
  ).toBeUndefined();
  expect(await check("The median wait is 55 seconds.", [demand])).toBeDefined();
  expect(
    await check("The median wait is 55 seconds.", [result, demand]),
  ).toBeDefined();
  expect(
    await check(
      "I would favor the barista while the equipment price is unknown.",
      [],
    ),
  ).toBeUndefined();
});

it.each([
  "",
  '  "rerunComparison": {\n    "seed": 42\n  },\n',
  '  "rerunComparison": null,\n',
])("reads complete leading figures from a truncated action result with prefix %j", async (prefix) => {
  const content = `{
${prefix}  "decision": {
    "chatFigureBasis": {
      "scenarios": []
    },
    "chatFigures": {
      "waitP50": {
        "text": "215.17 seconds",
        "tag": "illustrative"
      }
    },
    "receipt": {
      "settings": { "seed": 42

...[truncated — full result was 50,100 chars; only first 50,000 shown]`;
  expect(
    await check("The illustrative p50 wait is 215.17 seconds.", [
      { ...result, content },
    ]),
  ).toBeUndefined();
  expect(
    await check("The illustrative p50 wait is 42 seconds.", [
      { ...result, content },
    ]),
  ).toBeDefined();
});
