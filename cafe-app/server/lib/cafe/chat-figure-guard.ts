import type { AgentLoopFinalResponseGuard } from "@agent-native/core/server";

import { chatFiguresSchema } from "./chat-figures.js";

const resultActions = new Set([
  "run-simulation",
  "get-simulation",
  "compare-scenarios",
  "get-comparison",
  "compute-runway",
  "explain-result",
  "set-pedestrian-count",
]);
const inputActions = new Set([
  "list-scenarios",
  "create-scenario",
  "set-spot",
  "set-demand",
  "configure-shop",
  "configure-finance",
  "tag-source",
  "view-screen",
]);
const uuid =
  /(?<![\p{L}\p{N}])[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\p{L}\p{N}])/giu;
const numberWord =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|dozens?|half|halves|quarters?|twice|thrice)\b/iu;
const writtenDate =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:first|second)\b/iu;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function quoteableFigures(content: string) {
  const parsed = object(parseJson(content));
  const payload = object(parsed?.decision) ?? parsed;
  // Agent-Native can truncate a large tool result after the leading quote fields.
  const leading = parsed
    ? undefined
    : content.match(
        /^\{\n(?: {2}"decision": \{\n)?( {2,4})"chatFigures": (\{[\s\S]*?\n\1\})(?=,|\n)/,
      )?.[2];
  const result = chatFiguresSchema.safeParse(
    payload?.chatFigures ?? (leading && parseJson(leading)),
  );
  return result.success
    ? Object.values(result.data).map(({ text }) => text)
    : [];
}

function addInputNumbers(value: unknown, allowed: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    allowed.add(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) addInputNumbers(item, allowed);
  } else {
    const fields = object(value);
    if (fields)
      for (const item of Object.values(fields)) addInputNumbers(item, allowed);
  }
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const guardCafeFigures: AgentLoopFinalResponseGuard = ({
  text,
  toolResults,
}) => {
  const allowed = new Set<string>();
  const reportsResults = toolResults.some(({ name }) =>
    resultActions.has(name),
  );
  for (const { name, content, isError } of toolResults) {
    if (isError) continue;
    if (resultActions.has(name)) {
      for (const quote of quoteableFigures(content)) allowed.add(quote);
    } else if (!reportsResults && inputActions.has(name)) {
      addInputNumbers(parseJson(content), allowed);
    }
  }

  let remainder = text
    .replace(uuid, " ")
    .replace(/^[ \t]{0,3}(?:[-*+]|\d{1,2}[.)])[ \t]+/gm, " ");
  if (reportsResults) remainder = remainder.replace(/\bp(?:50|90)\b/giu, " ");
  for (const { toolCallId } of toolResults) {
    if (toolCallId && /^[A-Za-z_][\w-]{7,}$/.test(toolCallId)) {
      remainder = remainder.replace(
        new RegExp(`(?<![\\w-])${escapeRegex(toolCallId)}(?![\\w-])`, "g"),
        " ",
      );
    }
  }
  if (allowed.size) {
    const quotes = [...allowed]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex)
      .join("|");
    remainder = remainder.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}.,])(?<![+−±\\-\\p{Sc}][ \\t]*)(?<!\\b(?:[Nn]egative|[Pp]ositive|[Mm]inus|[Pp]lus)\\s+)(?:${quotes})(?![\\p{L}\\p{N}%]|[.,]\\p{N})`,
        "gu",
      ),
      " ",
    );
  }
  remainder = remainder.normalize("NFKC");
  if (
    !/[\p{N}\p{Sc}%]/u.test(remainder) &&
    !numberWord.test(remainder) &&
    !writtenDate.test(remainder)
  )
    return;

  return {
    retryMessage:
      "The draft contains a number or numeric wording outside a figure returned by a successful action this turn. For simulation, comparison, runway or conversion, copy each entire chatFigures.text value verbatim, including signs, decimal places, currency and units. Keep the figure attached to its original scenario and meaning. Do not calculate, round, convert, abbreviate, spell out, or infer numbers. If the needed quote is missing, call a fresh action or omit the number and explain qualitatively. Keep your own recommendation and the reversing assumption.",
    fallbackMessage:
      "I couldn't verify the figures in my reply against the action results. The recorded results are in the tool output above.",
    clearAllText: true,
    maxRetries: 1,
  };
};
