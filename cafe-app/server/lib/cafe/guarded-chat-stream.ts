import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "@agent-native/core/agent/engine";

const guardedEngines = new WeakSet<AgentEngine>();
const unguardedPresentationTools = new Set([
  "ask-question",
  "render-data-widget",
]);

export function isCafeChatActionAllowed(name: string) {
  return !unguardedPresentationTools.has(name);
}

export function holdCafeDrafts(engine: AgentEngine) {
  if (guardedEngines.has(engine)) return;
  const stream = engine.stream.bind(engine);
  engine.stream = (options) =>
    holdDraft(
      stream(options),
      options.abortSignal,
      new Set(
        options.tools.map(({ name }) => name).filter(isCafeChatActionAllowed),
      ),
    );
  guardedEngines.add(engine);
}

async function* holdDraft(
  events: AsyncIterable<EngineEvent>,
  signal: AbortSignal,
  offeredTools: ReadonlySet<string>,
): AsyncGenerator<EngineEvent> {
  const textDeltas: string[] = [];
  const toolInputs = new Map<
    string,
    { name?: string; started?: boolean; published?: boolean }
  >();
  const toolEvents: Extract<
    EngineEvent,
    { type: "tool-call" | "tool-call-error" }
  >[] = [];
  let content: EngineContentPart[] = [];
  let finish: Extract<EngineEvent, { type: "stop" }> | undefined;
  let toolAttempted = false;
  let modelStarted = false;

  function claimTool(id: string, name?: string) {
    const tracked = toolInputs.get(id) ?? {};
    if (name && !tracked.name) tracked.name = name;
    toolInputs.set(id, tracked);
    return tracked;
  }

  function acceptsTool(id: string, name: string) {
    return id && claimTool(id, name).name === name && offeredTools.has(name);
  }

  function* publishToolInput(
    id: string,
    name: string,
    input: unknown,
  ): Generator<EngineEvent> {
    const tracked = toolInputs.get(id);
    if (!tracked?.started || tracked.published) return;
    tracked.published = true;
    yield { type: "tool-input-start", id, name };
    const text = JSON.stringify(input);
    if (text !== undefined) yield { type: "tool-input-delta", id, name, text };
  }

  for await (const event of events) {
    if (signal.aborted) return;
    if (event.type === "gateway-heartbeat") {
      yield event;
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
      case "tool-input-delta": {
        toolAttempted = true;
        if (event.id) claimTool(event.id, event.name).started = true;
        break;
      }
      case "tool-call":
      case "tool-call-error":
        toolAttempted = true;
        if (acceptsTool(event.id, event.name)) toolEvents.push(event);
        break;
      case "assistant-content":
        content = [];
        for (const part of event.parts) {
          if (part.type === "tool-result") continue;
          if (part.type === "tool-call") {
            toolAttempted = true;
            if (!acceptsTool(part.id, part.name)) continue;
          }
          content.push(part);
        }
        break;
      case "stop":
        if (event.reason === "error") {
          yield event;
          return;
        }
        finish = event;
        break;
      case "usage":
        yield event;
    }
  }

  if (signal.aborted) return;
  const completedReply =
    (finish?.reason === "end_turn" || finish?.reason === "stop_sequence") &&
    !toolAttempted;
  if (completedReply) {
    if (!content.some(({ type }) => type === "text") && textDeltas.length > 0)
      content = [...content, { type: "text", text: textDeltas.join("") }];
  } else {
    content = content.filter(({ type }) => type !== "text");
  }
  for (const event of toolEvents) {
    if (event.type === "tool-call")
      yield* publishToolInput(event.id, event.name, event.input);
    yield event;
  }
  for (const part of content) {
    if (part.type === "tool-call")
      yield* publishToolInput(part.id, part.name, part.input);
  }
  if (content.length > 0) yield { type: "assistant-content", parts: content };
  if (finish) yield finish;
}
