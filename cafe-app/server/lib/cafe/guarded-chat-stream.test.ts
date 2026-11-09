import type { AgentEngine, EngineEvent } from "@agent-native/core/agent/engine";
import { expect, it } from "vitest";

import { holdCafeDrafts } from "./guarded-chat-stream.js";

function heldStream(
  stream: AgentEngine["stream"],
  signal = new AbortController().signal,
) {
  const engine: AgentEngine = {
    name: "test-engine",
    label: "Test engine",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: true,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    stream,
  };
  holdCafeDrafts(engine);
  return engine.stream({
    model: engine.defaultModel,
    systemPrompt: "",
    messages: [],
    tools: [],
    abortSignal: signal,
  });
}

async function collect(stream: AsyncIterable<EngineEvent>) {
  const events: EngineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

it("preserves live tool progress and signed tool history without publishing draft prose", async () => {
  const tool = {
    type: "tool-call",
    id: "call_probe",
    name: "list-scenarios",
    input: {},
  } as const;
  const reasoning = {
    type: "thinking",
    text: "Unverified reasoning",
    signature: "provider-signed",
  } as const;
  const events = await collect(
    heldStream(async function* () {
      yield { type: "text-delta", text: "Unverified draft" };
      yield { type: "thinking-delta", text: reasoning.text };
      yield { type: "tool-input-start", id: tool.id, name: tool.name };
      yield tool;
      yield {
        type: "assistant-content",
        parts: [reasoning, { type: "text", text: "Unverified draft" }, tool],
      };
      yield { type: "stop", reason: "tool_use" };
    }),
  );
  expect(events).toContainEqual({
    type: "tool-input-start",
    id: tool.id,
    name: tool.name,
  });
  expect(events).toContainEqual(tool);
  expect(
    events.filter(
      ({ type }) => type === "text-delta" || type === "thinking-delta",
    ),
  ).toEqual([]);
  expect(events.slice(-2)).toEqual([
    { type: "assistant-content", parts: [reasoning, tool] },
    { type: "stop", reason: "tool_use" },
  ]);
});

it("submits the provider's complete assistant content for the final guard", async () => {
  const final = {
    type: "assistant-content",
    parts: [{ type: "text", text: "The checked reply." }],
  } as const;
  const events = await collect(
    heldStream(async function* () {
      yield { type: "text-delta", text: "Earlier draft." };
      yield { ...final, parts: [...final.parts] };
      yield { type: "stop", reason: "end_turn" };
    }),
  );
  expect(events.some(({ type }) => type === "text-delta")).toBe(false);
  expect(events.slice(-2)).toEqual([
    final,
    { type: "stop", reason: "end_turn" },
  ]);
});

it.each(["max_tokens", "aborted", "late_error"] as const)(
  "drops drafts when a model call ends with %s",
  async (mode) => {
    const controller = new AbortController();
    const observed: EngineEvent[] = [];
    const consume = async () => {
      for await (const event of heldStream(async function* () {
        yield { type: "text-delta", text: "Unsupported draft." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Unsupported draft." }],
        };
        if (mode === "aborted") controller.abort();
        yield {
          type: "stop",
          reason: mode === "max_tokens" ? "max_tokens" : "end_turn",
        };
        if (mode === "late_error")
          throw new Error("Provider failed after stop");
      }, controller.signal))
        observed.push(event);
    };
    if (mode === "late_error")
      await expect(consume()).rejects.toThrow("Provider failed after stop");
    else await consume();
    expect(JSON.stringify(observed)).not.toContain("Unsupported draft.");
  },
);
