import { randomUUID } from "node:crypto";

import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
  EngineTool,
} from "@agent-native/core/agent/engine";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";

import { cafeActionTextCheck } from "./chat-action-text.js";
import { safeProviderFailure } from "./chat-provider-failure.js";
import {
  currentReviewScope,
  REVIEW_ACTION,
  reviewTerminalSentinel,
} from "./structured-review.js";

const guardedEngines = new WeakSet<AgentEngine>();
export const cafeChatTools = [
  "list-scenarios",
  "create-scenario",
  "set-spot",
  "set-demand",
  "set-pedestrian-count",
  "tag-source",
  "configure-shop",
  "configure-finance",
  "compare-scenarios",
  "get-comparison",
  "compute-runway",
  "explain-result",
  "run-simulation",
  "get-simulation",
  "view-screen",
  "navigate",
  "hello",
];
const allowedChatTools = new Set([
  ...cafeChatTools,
  "tool-search",
  "read-attachment",
]);
const draft07 = addFormats(
  new Ajv({ strict: false, ownProperties: true, addUsedSchema: false }),
);
const draft2020 = addFormats(
  new Ajv2020({ strict: false, ownProperties: true, addUsedSchema: false }),
);
const validators = new WeakMap<
  EngineTool["inputSchema"],
  ValidateFunction | null
>();
const safeToolId = /^[a-z\d_.:-]{1,128}$/i;

type ToolCall = Extract<EngineEvent, { type: "tool-call" }>;
type ToolError = Extract<EngineEvent, { type: "tool-call-error" }>;
type ToolRecord = {
  id: string;
  name?: string;
  inputAnnounced?: boolean;
  startPublished?: boolean;
  result?: ToolCall | ToolError;
};

export function isCafeChatActionAllowed(name: string) {
  return allowedChatTools.has(name);
}

export function holdCafeDrafts(engine: AgentEngine) {
  if (guardedEngines.has(engine)) return;
  const stream = engine.stream.bind(engine);
  engine.stream = (options) => holdDraft(() => stream(options), options);
  guardedEngines.add(engine);
}

function schemaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closeDeclaredFields(schema: unknown, close = true): unknown {
  if (!schemaObject(schema)) return schema;
  const checked = { ...schema };
  for (const keyword of [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
  ]) {
    const children = schema[keyword];
    if (!schemaObject(children)) continue;
    checked[keyword] = Object.fromEntries(
      Object.entries(children).map(([key, value]) => [
        key,
        closeDeclaredFields(value),
      ]),
    );
  }
  for (const keyword of [
    "items",
    "prefixItems",
    "anyOf",
    "oneOf",
    "allOf",
    "additionalProperties",
  ]) {
    const child = schema[keyword];
    if (Array.isArray(child))
      checked[keyword] = child.map((part) =>
        closeDeclaredFields(part, keyword !== "allOf"),
      );
    else if (schemaObject(child)) checked[keyword] = closeDeclaredFields(child);
  }
  // Core's Zod input schemas omit closure at every declared object level.
  // Explicit maps and composed schemas keep their declared behavior.
  if (
    close &&
    schemaObject(schema.properties) &&
    schema.additionalProperties === undefined &&
    schema.unevaluatedProperties === undefined &&
    !schema.$ref &&
    !schema.allOf &&
    !schema.anyOf &&
    !schema.oneOf
  )
    checked.additionalProperties = false;
  return checked;
}

function validatedInput(schema: EngineTool["inputSchema"], input: unknown) {
  try {
    let validate = validators.get(schema);
    if (validate === undefined) {
      const dialect =
        schema.$schema === "https://json-schema.org/draft/2020-12/schema"
          ? draft2020
          : draft07;
      try {
        validate = dialect.compile(
          closeDeclaredFields(schema) as EngineTool["inputSchema"],
        );
      } catch {
        validate = null;
      }
      validators.set(schema, validate);
    }
    const json = JSON.stringify(input === undefined ? {} : input);
    const value: unknown = JSON.parse(json);
    if (validate?.(value)) return value;
  } catch {
    // Tool calls must contain JSON, even when a provider supplies a custom engine.
  }
}

async function* holdDraft(
  stream: () => AsyncIterable<EngineEvent>,
  { abortSignal: signal, messages, tools }: EngineStreamOptions,
): AsyncGenerator<EngineEvent> {
  const acceptsText = cafeActionTextCheck();
  const review = currentReviewScope();
  const offeredTools = new Map(
    tools
      .filter(({ name }) =>
        review
          ? name === REVIEW_ACTION
          : name !== REVIEW_ACTION && isCafeChatActionAllowed(name),
      )
      .map(({ name, inputSchema }) => [name, inputSchema]),
  );
  const textDeltas: string[] = [];
  const toolRecords = new Map<string, ToolRecord>();
  let content: EngineContentPart[] = [];
  let finish: Extract<EngineEvent, { type: "stop" }> | undefined;
  let toolAttempted = false;
  let modelStarted = false;

  function claimTool(id: string, name?: string) {
    const record = toolRecords.get(id) ?? { id: `call_${randomUUID()}` };
    if (name && !record.name) record.name = name;
    toolRecords.set(id, record);
    return record;
  }

  function completeTool(call: ToolCall | ToolError) {
    if (!safeToolId.test(call.id)) return;
    const schema = offeredTools.get(call.name);
    const record = claimTool(call.id, call.name);
    if (!schema || record.name !== call.name) return;
    if (record.result?.type === "tool-call-error") return record;
    const input =
      call.type === "tool-call"
        ? validatedInput(schema, call.input)
        : undefined;
    if (input === undefined || !acceptsText(call.name, input)) {
      record.result = {
        type: "tool-call-error",
        id: record.id,
        name: call.name,
        input: {},
        error:
          input === undefined
            ? "The arguments did not match the offered action schema"
            : "Use qualitative text, or copy the complete numeric text from the founder or a current café action",
      };
    } else if (!record.result) {
      record.result = {
        type: "tool-call",
        id: record.id,
        name: call.name,
        input,
      };
    }
    return record;
  }

  function startTool(record?: ToolRecord): EngineEvent | undefined {
    if (
      !record?.inputAnnounced ||
      record.startPublished ||
      record.result?.type !== "tool-call"
    )
      return;
    record.startPublished = true;
    return {
      type: "tool-input-start",
      id: record.result.id,
      name: record.result.name,
    };
  }

  try {
    for await (const event of stream()) {
      if (signal.aborted) return;
      if (event.type === "gateway-heartbeat") {
        yield { type: "gateway-heartbeat" };
        continue;
      }
      // Core treats empty content as provider progress without publishing it.
      if (!modelStarted) yield { type: "assistant-content", parts: [] };
      modelStarted = true;
      switch (event.type) {
        case "text-delta":
          textDeltas.push(event.text);
          break;
        case "thinking-delta":
          break;
        case "tool-input-start":
        case "tool-input-delta":
          toolAttempted = true;
          if (event.id && safeToolId.test(event.id))
            claimTool(event.id, event.name).inputAnnounced = true;
          break;
        case "tool-call":
        case "tool-call-error": {
          toolAttempted = true;
          const start = startTool(completeTool(event));
          if (start) yield start;
          break;
        }
        case "assistant-content": {
          const assistantToolIds = new Set<string>();
          content = [];
          for (const part of event.parts) {
            if (part.type === "tool-call") {
              toolAttempted = true;
              const record = completeTool(part);
              const start = startTool(record);
              if (start) yield start;
              if (
                record?.result?.type === "tool-call" &&
                !assistantToolIds.has(part.id)
              ) {
                assistantToolIds.add(part.id);
                content.push(record.result);
              }
            } else if (part.type === "text" || part.type === "thinking") {
              content.push(part);
            }
          }
          break;
        }
        case "stop":
          if (event.reason === "error") {
            yield safeProviderFailure(undefined, messages, event);
            return;
          }
          finish = { type: "stop", reason: event.reason };
          break;
        case "usage":
          yield event;
      }
    }
  } catch (failure) {
    if (!signal.aborted) yield safeProviderFailure(failure, messages);
    return;
  }

  if (signal.aborted) return;
  const completedReply =
    (finish?.reason === "end_turn" || finish?.reason === "stop_sequence") &&
    !toolAttempted;
  if (completedReply) {
    if (!content.some(({ type }) => type === "text") && textDeltas.length > 0)
      content = [...content, { type: "text", text: textDeltas.join("") }];
    if (
      review &&
      !content.some((part) => part.type === "text" && part.text.trim())
    ) {
      const sentinel = reviewTerminalSentinel(review.receiptId);
      if (sentinel) content.push({ type: "text", text: sentinel });
    }
  } else {
    const outcomes = new Set(
      [...toolRecords.values()].map(({ result }) => result),
    );
    content = content.filter((part) =>
      part.type === "tool-call" ? outcomes.has(part) : part.type !== "text",
    );
  }
  for (const record of toolRecords.values()) {
    const call = record.result;
    if (!call) continue;
    if (call.type === "tool-call") {
      if (record.startPublished)
        yield {
          type: "tool-input-delta",
          id: call.id,
          name: call.name,
          text: JSON.stringify(call.input),
        };
    }
    yield call;
  }
  if (content.length > 0) yield { type: "assistant-content", parts: content };
  if (finish) yield finish;
}
