import { getRequestRunContext } from "@agent-native/core/server";

import { isSnapshotPlaceName } from "../../../shared/cafe/site-map.js";
import {
  cafeActionTextEvidence,
  containsCafeQuantity,
} from "./chat-figure-guard.js";

const founderTexts = new WeakMap<
  NonNullable<ReturnType<typeof getRequestRunContext>>,
  string
>();
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const idKeys = new Set([
  "id",
  "aId",
  "bId",
  "runId",
  "receiptId",
  "expectedReceiptId",
  "threadId",
]);
const cafeNavigation =
  /^\/cafe(?:\?scenario=[a-f\d-]+(?:&compare=[a-f\d-]+)?)?(?:#(?:opening-file|site-demand|service-test|cash-ledger))?$/i;
const chatNavigation = /^\/chat\/([a-f\d-]+)$/i;

export function recordCafeFounderText(message: string) {
  const context = getRequestRunContext();
  if (context) founderTexts.set(context, message);
}

function founderQuoted(value: string, founder: string) {
  let start = founder.indexOf(value);
  while (start >= 0) {
    const before = founder[start - 1] ?? "";
    const after = founder[start + value.length] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after))
      return true;
    start = founder.indexOf(value, start + value.length);
  }
  return false;
}

export function cafeActionTextAllowed(
  tool: string,
  input: unknown,
  founder: string,
  evidence: ReadonlySet<string>,
) {
  function allowed(value: unknown, key = "", parent = ""): boolean {
    if (Array.isArray(value))
      return value.every((entry) => allowed(entry, "", key));
    if (value !== null && typeof value === "object")
      return Object.entries(value).every(
        ([field, entry]) =>
          !containsCafeQuantity(field) && allowed(entry, field, key || parent),
      );
    if (typeof value !== "string" || !containsCafeQuantity(value)) return true;
    if (idKeys.has(key) && uuid.test(value)) return true;
    if (tool === "list-scenarios") {
      if (key === "after" && parent === "catalog" && uuid.test(value))
        return true;
      if (
        key === "version" &&
        (parent === "catalog" || parent === "input") &&
        /^[a-f\d]{24}$/.test(value)
      )
        return true;
      if (parent === "path") {
        if (/^equipmentQuote\.(?:[0-9]|1[0-9])$/.test(value)) return true;
        const worker = value.match(/^shifts\.(.+)\.[0-7]$/u)?.[1];
        if (worker && evidence.has(worker)) return true;
      }
    }
    if (
      (tool === "set-playback-position" || tool === "set-playback-controls") &&
      ["scenarioId", "comparisonScenarioId", "comparisonRunId"].includes(key) &&
      uuid.test(value)
    )
      return true;
    if (
      parent === "workers" &&
      key === "id" &&
      /^(?:barista|worker)-[1-9]\d?$/i.test(value)
    )
      return true;
    if (
      parent === "workers" &&
      key === "name" &&
      /^(?:barista|worker) [1-9]\d?$/i.test(value)
    )
      return true;
    if (
      tool === "tag-source" &&
      key === "path" &&
      /^[A-Za-z]+(?:\.(?:[A-Za-z]+|\d{1,2}))+$/u.test(value)
    )
      return true;
    if (
      tool === "set-spot" &&
      key === "placeName" &&
      isSnapshotPlaceName(value)
    )
      return true;
    if (tool === "navigate" && key === "path") {
      const chat = value.match(chatNavigation);
      if (chat && uuid.test(chat[1]!)) return true;
      if (cafeNavigation.test(value)) {
        const url = new URL(value, "https://cafe.invalid");
        if ([...url.searchParams.values()].every((id) => uuid.test(id)))
          return true;
      }
    }
    return evidence.has(value) || founderQuoted(value, founder);
  }
  return allowed(input);
}

export function cafeActionTextCheck() {
  const context = getRequestRunContext();
  const founder = context ? (founderTexts.get(context) ?? "") : "";
  const evidence = cafeActionTextEvidence({
    toolCalls: context?.toolCalls ?? [],
    toolResults: context?.toolResults ?? [],
  });
  return (tool: string, input: unknown) =>
    cafeActionTextAllowed(tool, input, founder, evidence);
}
