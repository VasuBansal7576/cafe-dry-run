import type {
  AgentLoopFinalResponseGuard,
  AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";

import { isSnapshotPlaceName } from "../../../shared/cafe/site-map.js";
import {
  chatFigureBasisSchema,
  type ChatFigureBasis,
  type ChatFigureObservations,
} from "./chat-figure-basis.js";
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
const revisionWrites = new Set([
  "set-demand",
  "configure-shop",
  "configure-finance",
  "tag-source",
  "set-pedestrian-count",
]);
const scenarioActions = new Set([
  "list-scenarios",
  "create-scenario",
  ...revisionWrites,
]);
const siteActions = new Set(["set-spot", "view-screen"]);

const uuid =
  /(?<![\p{L}\p{N}])[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\p{L}\p{N}])/giu;
const numberWord =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|dozens?|half|halves|quarters?|twice|thrice)\b/iu;
const writtenDate =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:first|second)\b/iu;
const implicitNumber =
  /\b(?:couple of|(?:first|second)[ -]place|(?:a|an) (?:second|minute|hour|day|week|month|year|rupee)(?=\s+(?:of|faster|slower|less|more|off|per|each|longer|shorter)\b|[.,;!?)\n]|$)|a k rupees|double(?![- ]check\b)|doubled|tripl(?:e|ed))\b/iu;
const approximateMeasure =
  /\b(?:(?:several|a few|few)\s+(?:seconds|minutes|hours|days|weeks|months|years|rupees|orders|customers)|(?:under|over|about|within|less than|more than|at least|at most|around)\s+(?:a|an)\s+(?:second|minute|hour|day|week|month|year|rupee|order|customer))\b/iu;
const adjacentPlaceQuantity =
  /^[\s\p{Cf}\p{Pd}*_\x60~]+(?:m|km|ft|mi|feet|metres?|meters?|kilometres?|kilometers?|miles?|seconds?|minutes?|hours?|days?|weeks?|months?|years?|rupees?|inr|percent|orders?|customers?|drinks?|coffees?|beverages?|cups?|servings?|seats?|visitors?|pedestrians?|passers[ -]by|times)(?![\p{L}\p{N}])/iu;

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

function resultPayload(
  parsed: Record<string, unknown> | undefined,
  content: string,
) {
  if (parsed) return object(parsed.decision) ?? parsed;
  // Core can truncate after these leading fields, before the raw receipt or playback.
  const leading = content.match(
    /^\{\n(?: {2}"decision": \{\n)?( {2,4})"chatFigureBasis": (\{[\s\S]*?\n\1\}),\n\1"chatFigures": (null|\{[\s\S]*?\n\1\})(?=,|\n)/,
  );
  return leading?.[2] && leading[3]
    ? {
        chatFigureBasis: parseJson(leading[2]),
        chatFigures: parseJson(leading[3]),
      }
    : undefined;
}

function visibleScenarioHeaders(content: string) {
  if (!content.startsWith('{\n  "scenarios": [\n')) return [];
  // Only authorize complete quote records. The raw shop or finance fields can be clipped later in the same scenario.
  const headers = [
    ...content.matchAll(
      /^ {4}\{\n((?: {6}"(?:id|revision|financeRevision|label|latestRunId)": [^\n]+,\n){5}) {6}"chatFigures": \{\n/gm,
    ),
  ];
  return headers.flatMap((match, index) => {
    const scenario = object(
      parseJson("{" + match[1]!.trimEnd().slice(0, -1) + "}"),
    );
    if (!scenario) return [];
    const remainder = content.slice(
      match.index + match[0].length,
      headers[index + 1]?.index,
    );
    const end = remainder.search(/^ {6}\},?$/m);
    const figures = end < 0 ? remainder : remainder.slice(0, end);
    const chatFigures = Object.fromEntries(
      [
        ...figures.matchAll(
          /^ {8}("(?:[^"\\]|\\.)*"): (\{\n[\s\S]*?^ {8}\})(?=,?$)/gm,
        ),
      ].flatMap(([, key, figure]) => {
        const name = parseJson(key!);
        const value = parseJson(figure!);
        return typeof name === "string" && value ? [[name, value]] : [];
      }),
    );
    const spot = remainder.match(
      /^ {6}"spot": (\{\n[\s\S]*?^ {6}\})(?=,?$)/m,
    )?.[1];
    return [{ ...scenario, chatFigures, spot: spot && parseJson(spot) }];
  });
}

type ScenarioVersion = ChatFigureObservations["scenarios"][number];
type AssumptionVersion = NonNullable<ChatFigureBasis["assumption"]>;
type QuoteSource = { index: number; basis: ChatFigureBasis; quotes: string[] };

function quoteTexts(value: unknown): string[] {
  const parsed = chatFiguresSchema.safeParse(value);
  return parsed.success
    ? Object.values(parsed.data)
        .map(({ text }) => text)
        .filter(Boolean)
    : [];
}

function turnQuoteSources({
  toolResults,
  toolCalls,
}: AgentLoopFinalResponseGuardContext) {
  const sources: QuoteSource[] = [];
  const sites: { index: number; names: string[] }[] = [];
  const scenarios = new Map<string, ScenarioVersion>();
  const assumptions = new Map<string, AssumptionVersion>();
  const latestRuns = new Map<string, string | null>();
  const staleRuns = new Set<string>();
  const staleReceipts = new Set<string>();
  const unknownEdits: { index: number; id?: string }[] = [];
  const calls = new Map(
    toolCalls.map(({ toolCallId, input }) => [toolCallId, object(input)]),
  );
  const recordSites = (index: number, values: unknown[]) => {
    const names = values.filter(
      (value): value is string =>
        typeof value === "string" && isSnapshotPlaceName(value),
    );
    if (names.length) sites.push({ index, names });
  };

  const observeScenario = (version: ScenarioVersion) => {
    const previous = scenarios.get(version.id);
    if (
      version.latestRunId !== undefined &&
      (version.revision ?? -1) >= (previous?.revision ?? -1)
    ) {
      latestRuns.set(version.id, version.latestRunId);
    }
    scenarios.set(version.id, {
      id: version.id,
      revision: Math.max(previous?.revision ?? -1, version.revision ?? -1),
      financeRevision: Math.max(
        previous?.financeRevision ?? -1,
        version.financeRevision ?? -1,
      ),
    });
  };

  for (const [
    index,
    { name, content, isError, toolCallId },
  ] of toolResults.entries()) {
    if (
      isError ||
      (!resultActions.has(name) &&
        !scenarioActions.has(name) &&
        !siteActions.has(name))
    )
      continue;
    const parsed = object(parseJson(content));
    if (name === "set-spot") {
      const places = object(parsed?.map)?.places;
      recordSites(index, [
        object(parsed?.spot)?.label,
        ...(Array.isArray(places)
          ? places.map((place) => object(place)?.name)
          : []),
      ]);
    } else if (name === "view-screen") {
      recordSites(index, [object(object(parsed?.site)?.spot)?.label]);
    }
    const input = calls.get(toolCallId);
    const returnedScenarios = [
      parsed?.scenario,
      parsed?.arrivalSource,
      ...(Array.isArray(parsed?.scenarios) ? parsed.scenarios : []),
      ...(!parsed && name === "list-scenarios"
        ? visibleScenarioHeaders(content)
        : []),
    ];
    for (const raw of returnedScenarios) {
      const scenario = object(raw);
      if (
        typeof scenario?.id !== "string" ||
        typeof scenario.revision !== "number"
      )
        continue;
      const version: ScenarioVersion = {
        id: scenario.id,
        revision: scenario.revision,
        ...(typeof scenario.financeRevision === "number"
          ? { financeRevision: scenario.financeRevision }
          : {}),
        ...(scenario.latestRunId === null ||
        typeof scenario.latestRunId === "string"
          ? { latestRunId: scenario.latestRunId }
          : {}),
      };
      observeScenario(version);
      recordSites(index, [object(scenario.spot)?.label]);
      const quotes = quoteTexts(scenario.chatFigures);
      if (typeof scenario.label === "string") {
        quotes.push(
          "scenario " + JSON.stringify(scenario.label),
          "Scenario " + JSON.stringify(scenario.label),
        );
        if (/^\p{L}+(?: \p{L}+){0,4} \d{1,2}$/u.test(scenario.label)) {
          for (const verb of ["choose", "prefer", "recommend", "select"]) {
            quotes.push(
              `${verb} ${scenario.label}`,
              `${verb[0]!.toUpperCase()}${verb.slice(1)} ${scenario.label}`,
            );
          }
        }
      }
      if (quotes.length)
        sources.push({ index, basis: { scenarios: [version] }, quotes });
    }
    if (
      revisionWrites.has(name) &&
      !object(parsed?.scenario) &&
      !content.startsWith("Not executed:") &&
      !input?.variantLabel &&
      (name !== "set-pedestrian-count" ||
        input?.pedestrian !== undefined ||
        !input)
    ) {
      unknownEdits.push({
        index,
        ...(typeof input?.id === "string" ? { id: input.id } : {}),
      });
    }
    if (!resultActions.has(name)) continue;
    const payload = resultPayload(parsed, content);
    const scope = chatFigureBasisSchema.safeParse(payload?.chatFigureBasis);
    if (!scope.success) continue;
    const basis = scope.data;
    for (const version of basis.observations?.scenarios ?? [])
      observeScenario(version);
    const assumption = basis.observations?.assumption;
    if (
      assumption &&
      assumption.revision >= (assumptions.get(assumption.pair)?.revision ?? -1)
    ) {
      assumptions.set(assumption.pair, assumption);
    }
    if (payload?.chatFigures === null) {
      if (basis.receiptId) staleReceipts.add(basis.receiptId);
      else for (const id of basis.runIds ?? []) staleRuns.add(id);
      continue;
    }
    for (const version of basis.scenarios) observeScenario(version);
    if (name === "run-simulation" && basis.scenarios[0] && basis.runIds?.[0]) {
      observeScenario({ ...basis.scenarios[0], latestRunId: basis.runIds[0] });
    }
    sources.push({ index, basis, quotes: quoteTexts(payload?.chatFigures) });
  }
  const figures = sources.filter(({ index, basis }) => {
    if (basis.receiptId && staleReceipts.has(basis.receiptId)) return false;
    if (basis.runIds?.some((id) => staleRuns.has(id))) return false;
    if (basis.latestRun) {
      const latestId = latestRuns.get(basis.latestRun.scenarioId);
      if (latestId !== undefined && latestId !== basis.latestRun.id)
        return false;
    }
    if (basis.assumption) {
      const observed = assumptions.get(basis.assumption.pair);
      if (
        observed &&
        (observed.revision > basis.assumption.revision ||
          (observed.revision === basis.assumption.revision &&
            (observed.savedCustomers.enabled !==
              basis.assumption.savedCustomers.enabled ||
              observed.savedCustomers.tag !==
                basis.assumption.savedCustomers.tag)))
      )
        return false;
    }
    if (
      unknownEdits.some(
        (edit) =>
          edit.index > index &&
          (!edit.id || basis.scenarios.some(({ id }) => id === edit.id)),
      )
    )
      return false;
    return basis.scenarios.every(({ id, revision, financeRevision }) => {
      const observed = scenarios.get(id);
      return (
        (revision === undefined || (observed?.revision ?? -1) <= revision) &&
        (financeRevision === undefined ||
          (observed?.financeRevision ?? -1) <= financeRevision)
      );
    });
  });
  return { figures, sites };
}

function currentDrafts({
  text,
  messages,
  toolResults,
}: AgentLoopFinalResponseGuardContext) {
  const positions = new Map(
    toolResults.flatMap(({ toolCallId }, index) =>
      toolCallId ? ([[toolCallId, index]] as const) : [],
    ),
  );
  let through = toolResults.length - 1;
  const drafts = [{ text, through }];
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant") {
      const earlier = message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");
      if (earlier && (through !== drafts[0]!.through || earlier !== text))
        drafts.push({ text: earlier, through });
      continue;
    }
    const results = message.content.filter(
      (part) => part.type === "tool-result",
    );
    if (results.length) {
      for (const { toolCallId } of results) {
        const position = positions.get(toolCallId);
        if (position !== undefined) through = Math.min(through, position - 1);
      }
      continue;
    }
    // A continuation keeps the interrupted draft visible. A guard retry has already cleared it.
    if (
      message.content.some(
        (part) =>
          part.type === "text" &&
          part.text.startsWith(
            "Continue from where you left off and finish the user's original request.",
          ),
      )
    )
      continue;
    break;
  }
  return drafts;
}

function escapeRegex(text: string) {
  return text.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&");
}

function hasUnsupportedNumber(
  text: string,
  allowed: Set<string>,
  toolIds: string[],
  siteNames: Set<string>,
) {
  let remainder = text.replace(/^[ \t]{0,3}(?:[-*+]|\d{1,2}[.)])[ \t]+/gm, " ");
  if (allowed.size) {
    const quotes = [...allowed]
      .sort((a, b) => b.length - a.length)
      .map((quote) => {
        const literal = escapeRegex(quote);
        const clauseEnd = "(?=[ \\t*_\\x60~]*(?:[.!?,;:()\\n]|$))";
        if (/^(?:choose|prefer|recommend|select) .+ \d{1,2}$/iu.test(quote))
          return literal + clauseEnd;
        if (!/^(?:"|From ")/.test(quote)) return literal;
        return (
          "(?<=^|[.!?\\n][ \\t]*|^[ \\t]*|[\\n][ \\t]*)(?:[*_\\x60~]*)" +
          literal +
          clauseEnd
        );
      })
      .join("|");
    const before =
      "(?<![\\p{L}\\p{N}.,])(?<![+−±\\-\\p{Sc}][ \\t*_\\x60~]*)(?<!\\b(?:[Nn]egative|[Pp]ositive|[Mm]inus|[Pp]lus)[ \\t*_\\x60~]+)";
    const after =
      "(?![\\p{L}\\p{N}%/]|[.,]\\p{N})(?![ \\t*_\\x60~]+(?:per|each|every|annually|monthly|weekly|daily|hourly|in total)\\b)";
    remainder = remainder.replace(
      new RegExp(before + "(?:" + quotes + ")" + after, "gu"),
      " ",
    );
  }
  if (siteNames.size) {
    const literals = [...siteNames]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    remainder = remainder.replace(
      new RegExp(
        "(?<![\\p{L}\\p{N}\\p{Sc}+−±-])(?:" +
          literals.join("|") +
          ")(?![\\p{L}\\p{N}%/]|[.,]\\p{N})",
        "gu",
      ),
      (name: string, offset: number, draft: string) => {
        const suffix = draft.slice(offset + name.length).normalize("NFKC");
        return /\p{N}/u.test(name) && adjacentPlaceQuantity.test(suffix)
          ? name
          : " ";
      },
    );
  }
  remainder = remainder
    .replace(uuid, " ")
    .replace(/\bp(?:50|90)(?=\s+(?:wait|is|was)\b)/giu, " ");
  for (const id of toolIds) {
    remainder = remainder.replace(
      new RegExp("(?<![\\w-])" + escapeRegex(id) + "(?![\\w-])", "g"),
      " ",
    );
  }
  remainder = remainder
    .normalize("NFKC")
    .replace(/\b(?:that|this|better|best|right|which|the other) one\b/giu, " ");
  return (
    /[\p{N}\p{Sc}%]/u.test(remainder) ||
    numberWord.test(remainder) ||
    writtenDate.test(remainder) ||
    implicitNumber.test(remainder) ||
    approximateMeasure.test(remainder)
  );
}

export const guardCafeFigures: AgentLoopFinalResponseGuard = (details) => {
  const { figures, sites } = turnQuoteSources(details);
  const ids = details.toolResults.flatMap(({ toolCallId }) =>
    toolCallId && /^[A-Za-z_][\w-]{7,}$/.test(toolCallId) ? [toolCallId] : [],
  );
  const unsupported = currentDrafts(details).some(({ text, through }) => {
    const allowed = new Set(
      figures
        .filter(({ index }) => index <= through)
        .flatMap(({ quotes }) => quotes),
    );
    const siteNames = new Set(
      sites
        .filter(({ index }) => index <= through)
        .flatMap(({ names }) => names),
    );
    return hasUnsupportedNumber(text, allowed, ids, siteNames);
  });
  if (!unsupported) return;

  return {
    retryMessage:
      "The draft contains a number or numeric wording outside a figure returned by a successful, still-current action this turn. Copy each entire chatFigures.text value verbatim on its own line or as its own sentence. Include the scenario, metric, sign, decimal places, currency and units. Saved input quotes are in scenario.chatFigures. Do not calculate, round, convert, abbreviate, spell out, or infer numbers. If the needed quote is missing, call a fresh action or omit the number and explain qualitatively. Keep your own recommendation and the reversing assumption.",
    fallbackMessage:
      "I couldn't verify the figures in my reply against the action results. The recorded results are in the tool output above.",
    clearAllText: true,
    maxRetries: 1,
  };
};
