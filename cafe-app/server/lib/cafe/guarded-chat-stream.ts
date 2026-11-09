import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "@agent-native/core/agent/engine";

const guardedEngines = new WeakSet<AgentEngine>();

export function holdCafeDrafts(engine: AgentEngine) {
  if (guardedEngines.has(engine)) return;
  const stream = engine.stream.bind(engine);
  engine.stream = (options) => holdDraft(stream(options), options.abortSignal);
  guardedEngines.add(engine);
}

async function* holdDraft(
  events: AsyncIterable<EngineEvent>,
  signal: AbortSignal,
): AsyncGenerator<EngineEvent> {
  const textDeltas: string[] = [];
  let content: EngineContentPart[] = [];
  let finish: Extract<EngineEvent, { type: "stop" }> | undefined;
  let toolCall = false;
  let modelStarted = false;

  for await (const event of events) {
    if (signal.aborted) return;
    if (event.type === "gateway-heartbeat") {
      yield event;
      continue;
    }
    if (
      event.type === "text-delta" ||
      event.type === "thinking-delta" ||
      event.type === "assistant-content"
    ) {
      if (event.type === "text-delta") textDeltas.push(event.text);
      if (event.type === "assistant-content") content = event.parts;
      // Core treats empty content as provider progress without publishing it.
      if (!modelStarted) yield { type: "assistant-content", parts: [] };
    } else if (event.type === "stop") {
      if (event.reason === "error") {
        yield event;
        return;
      }
      finish = event;
    } else {
      if (event.type === "tool-call" || event.type === "tool-call-error")
        toolCall = true;
      yield event;
    }
    modelStarted = true;
  }

  if (signal.aborted) return;
  const completedReply =
    (finish?.reason === "end_turn" || finish?.reason === "stop_sequence") &&
    !toolCall &&
    !content.some(({ type }) => type === "tool-call");
  if (completedReply) {
    if (!content.some(({ type }) => type === "text") && textDeltas.length > 0)
      content = [...content, { type: "text", text: textDeltas.join("") }];
  } else {
    content = content.filter(({ type }) => type !== "text");
  }
  if (content.length > 0) yield { type: "assistant-content", parts: content };
  if (finish) yield finish;
}
