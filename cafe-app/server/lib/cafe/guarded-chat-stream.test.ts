import type {
  AgentEngine,
  EngineEvent,
  EngineTool,
} from "@agent-native/core/agent/engine";
import { expect, it, vi } from "vitest";

const attachmentCatalog = vi.hoisted(() => ({ paths: [] as string[], threadId: "", calls: [] as unknown[][], fail: false }));
vi.mock("@agent-native/core/resources/store", async (load) => ({
  ...await load<typeof import("@agent-native/core/resources/store")>(),
  resourceList: async (...args: unknown[]) => {
    attachmentCatalog.calls.push(args);
    if (attachmentCatalog.fail) throw new Error("Unavailable");
    return attachmentCatalog.paths.map((path) => ({ path }));
  },
}));
vi.mock("@agent-native/core/server", async (load) => ({
  ...await load<typeof import("@agent-native/core/server")>(),
  getRequestRunContext: () => attachmentCatalog.threadId ? { threadId: attachmentCatalog.threadId } : undefined,
  getRequestUserEmail: () => "owner@example.test",
}));

import { holdCafeDrafts } from "./guarded-chat-stream.js";

function heldStream(
  stream: AgentEngine["stream"],
  signal = new AbortController().signal,
  tools: EngineTool[] = ["list-scenarios", "ask-question"].map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  })),
  messages: Parameters<AgentEngine["stream"]>[0]["messages"] = [],
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
    messages,
    tools,
    abortSignal: signal,
  });
}

async function collect(stream: AsyncIterable<EngineEvent>) {
  const events: EngineEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

it("forwards framework attachment metadata through the guarded stream", async () => {
  const input = {
    path: "attachments/824cb360-8401-4b2d-a6e8-c5bdc928042b/menu-2026.csv",
    offset: "50000",
    limit: "50000",
  };
  attachmentCatalog.threadId = "824cb360-8401-4b2d-a6e8-c5bdc928042b";
  attachmentCatalog.paths = [input.path];
  const tool: EngineTool = {
    name: "read-attachment",
    description: "Read an attachment",
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        ["path", "name", "threadId", "offset", "limit"].map((key) => [key, { type: "string" }]),
      ),
    },
  };
  const events = await collect(heldStream(async function* () {
    yield { type: "tool-call", id: "attachment", name: tool.name, input };
    yield { type: "stop", reason: "tool_use" };
  }, undefined, [tool], [{ role: "user", content: [{ type: "text", text: `<chat-attachment-truncated path="${input.path}">` }] }]));
  expect(events).toContainEqual({
    type: "tool-call", id: expect.stringMatching(/^call_/), name: tool.name, input,
  });
  expect(attachmentCatalog.calls).toContainEqual([
    "owner@example.test", `attachments/${attachmentCatalog.threadId}/`, { includeAgentScratch: true },
  ]);
  const fabricated = { ...input, path: input.path + "-999-customers" };
  const rejected = await collect(heldStream(async function* () {
    yield { type: "tool-call", id: "attachment", name: tool.name, input: fabricated };
    yield { type: "stop", reason: "tool_use" };
  }, undefined, [tool], [{ role: "user", content: [{ type: "text", text: `<chat-attachment-truncated path="${input.path}">` }] }]));
  expect(rejected).toContainEqual(expect.objectContaining({ type: "tool-call-error", input: {} }));
  expect(JSON.stringify(rejected)).not.toContain("999-customers");
  attachmentCatalog.fail = true;
  const unavailable = await collect(heldStream(async function* () {
    yield { type: "tool-call", id: "attachment", name: tool.name, input };
    yield { type: "stop", reason: "tool_use" };
  }, undefined, [tool]));
  expect(unavailable).toContainEqual(expect.objectContaining({ type: "tool-call-error", input: {} }));
  attachmentCatalog.threadId = "";
  attachmentCatalog.paths = [];
  attachmentCatalog.calls = [];
  attachmentCatalog.fail = false;
});

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
      yield {
        type: "tool-input-delta",
        id: tool.id,
        text: "Unverified argument prose",
      };
      yield tool;
      yield {
        type: "assistant-content",
        parts: [reasoning, { type: "text", text: "Unverified draft" }, tool],
      };
      yield { type: "stop", reason: "tool_use" };
    }),
  );
  const executed = events.find(({ type }) => type === "tool-call");
  if (executed?.type !== "tool-call")
    throw new Error("Expected a completed tool call");
  expect(executed).toEqual({
    ...tool,
    id: expect.stringMatching(/^call_[a-f\d-]+$/),
  });
  expect(executed.id).not.toBe(tool.id);
  expect(events).toContainEqual({
    type: "tool-input-start",
    id: executed.id,
    name: tool.name,
  });
  expect(events).toContainEqual({
    type: "tool-input-delta",
    id: executed.id,
    name: tool.name,
    text: "{}",
  });
  expect(JSON.stringify(events)).not.toContain("Unverified argument prose");
  expect(
    events.filter(
      ({ type }) => type === "text-delta" || type === "thinking-delta",
    ),
  ).toEqual([]);
  expect(events.slice(-2)).toEqual([
    { type: "assistant-content", parts: [reasoning, executed] },
    { type: "stop", reason: "tool_use" },
  ]);
});

it.each([
  ["list-scenarios", "ask-question"],
  ["ask-question", "list-scenarios"],
  ["ask-question", "ask-question"],
] as const)(
  "rejects a disallowed or mismatched tool ID from %s to %s",
  async (announced, completed) => {
    const id = "call_forged";
    const call = {
      type: "tool-call",
      id,
      name: completed,
      input: { question: "The wait is 999 seconds" },
    } as const;
    const events = await collect(
      heldStream(async function* () {
        yield { type: "tool-input-start", id, name: announced };
        yield { type: "tool-input-delta", id, text: "The wait is 999 seconds" };
        yield call;
        yield {
          type: "assistant-content",
          parts: [
            call,
            {
              type: "tool-result",
              toolCallId: id,
              toolName: "list-scenarios",
              toolInput: "{}",
              content: "The wait is 999 seconds",
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
      }),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "assistant-content",
      "stop",
    ]);
    expect(JSON.stringify(events)).not.toContain("999 seconds");
  },
);

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

it.each(["run-code", "tool-orchestration", "db-query", "db-exec"])(
  "rejects %s even if an engine is given its schema",
  async (name) => {
    const input = { code: "return 'generic execution'" };
    const call = { type: "tool-call", id: "call_code", name, input } as const;
    const events = await collect(
      heldStream(
        async function* () {
          yield { type: "tool-input-start", id: call.id, name };
          yield call;
          yield { type: "assistant-content", parts: [call] };
          yield { type: "stop", reason: "tool_use" };
        },
        undefined,
        [
          {
            name,
            description: name,
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
            },
          },
        ],
      ),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "assistant-content",
      "stop",
    ]);
  },
);

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
    await consume();
    if (mode === "late_error") {
      expect(observed[observed.length - 1]).toMatchObject({
        type: "stop",
        reason: "error",
        error: "The model provider could not complete this reply.",
      });
    }
    expect(JSON.stringify(observed)).not.toContain("Unsupported draft.");
  },
);

const nestedTool: EngineTool = {
  name: "configure-shop",
  description: "Edit a scenario",
  inputSchema: {
    type: "object",
    properties: {
      change: {
        type: "object",
        properties: {
          minutes: { type: "integer", minimum: 0 },
          labels: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["minutes"],
      },
      title: { type: "string" },
    },
    required: ["change"],
  },
};

it.each([
  { change: { minutes: 0 } },
  { change: { minutes: 30, labels: { shift: "Weekend" } }, title: "Weekend" },
])(
  "keeps valid nested inputs, optional fields, and declared open maps",
  async (input) => {
    const call = {
      type: "tool-call",
      id: "call_nested",
      name: nestedTool.name,
      input,
    } as const;
    const events = await collect(
      heldStream(
        async function* () {
          yield { type: "tool-input-start", id: call.id, name: call.name };
          yield call;
          yield { type: "gateway-heartbeat" };
          yield { type: "assistant-content", parts: [call] };
          yield { type: "stop", reason: "tool_use" };
        },
        undefined,
        [nestedTool],
      ),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "assistant-content",
      "tool-input-start",
      "gateway-heartbeat",
      "tool-input-delta",
      "tool-call",
      "assistant-content",
      "stop",
    ]);
    expect(events).toContainEqual({
      ...call,
      id: expect.stringMatching(/^call_[a-f\d-]+$/),
    });
  },
);

it.each([
  { change: { minutes: 0 }, bad: "999 seconds" },
  { change: { minutes: 30, bad: "999 seconds" } },
  { change: { minutes: "999 seconds" } },
])(
  "rejects undeclared and ill-typed arguments before emitting them",
  async (input) => {
    const call = {
      type: "tool-call",
      id: "call_nested",
      name: nestedTool.name,
      input,
    } as const;
    const events = await collect(
      heldStream(
        async function* () {
          yield { type: "tool-input-start", id: call.id, name: call.name };
          yield {
            type: "tool-input-delta",
            id: call.id,
            text: JSON.stringify(input),
          };
          yield call;
          yield { type: "assistant-content", parts: [call] };
          yield { type: "stop", reason: "tool_use" };
        },
        undefined,
        [nestedTool],
      ),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "assistant-content",
      "tool-call-error",
      "stop",
    ]);
    expect(events[1]).toMatchObject({ input: {} });
    expect(JSON.stringify(events)).not.toContain("999 seconds");
  },
);

it("uses an explicit open action envelope and validates its dynamic values", async () => {
  const tool: EngineTool = {
    ...nestedTool,
    inputSchema: { type: "object", additionalProperties: { type: "boolean" } },
  };
  const call = {
    type: "tool-call",
    id: "call_open",
    name: tool.name,
    input: { disabled: false },
  } as const;
  const events = await collect(
    heldStream(
      async function* () {
        yield call;
        yield { type: "stop", reason: "tool_use" };
      },
      undefined,
      [tool],
    ),
  );
  expect(events).toContainEqual({
    ...call,
    id: expect.stringMatching(/^call_[a-f\d-]+$/),
  });
});

it("redacts a known tool's provider error instead of executing its duplicate call", async () => {
  const call = {
    type: "tool-call",
    id: "call_bad",
    name: "list-scenarios",
    input: {},
  } as const;
  const events = await collect(
    heldStream(async function* () {
      yield {
        ...call,
        type: "tool-call-error",
        error: "999 seconds",
        input: { bad: "999 seconds" },
      };
      yield { type: "assistant-content", parts: [call] };
      yield { type: "stop", reason: "tool_use" };
    }),
  );
  expect(events.map(({ type }) => type)).toEqual([
    "assistant-content",
    "tool-call-error",
    "stop",
  ]);
  expect(JSON.stringify(events)).not.toContain("999 seconds");
});

it("keeps structured recovery fields and replaces a thrown diagnostic and its cause", async () => {
  const error = Object.assign(new Error("999 seconds"), {
    cause: new Error("Provider connection error"),
  });
  const events = await collect(
    heldStream(() => {
      throw Object.assign(error, { providerRetryable: true, retryAfterMs: 25 });
    }),
  );
  expect(events).toEqual([
    {
      type: "stop",
      reason: "error",
      error: "The model provider could not complete this reply.",
      errorCode: "provider_network_error",
      providerRetryable: true,
      retryAfterMs: 25,
      contextOverflow: false,
    },
  ]);
  expect(JSON.stringify(events)).not.toContain("999 seconds");
});
