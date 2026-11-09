import { expect, it } from "vitest";

import { cafeActionTextAllowed } from "./chat-action-text.js";
import { cafeActionTextEvidence } from "./chat-figure-guard.js";
import { safeProviderFailure } from "./chat-provider-failure.js";

it("requires the entire numeric name to come from the founder or a current action", () => {
  const label = "Cafe 24 / Bay 7";
  const action = {
    name: "list-scenarios",
    content: JSON.stringify({ scenarios: [{ label }] }),
    isError: false,
  };
  expect(
    cafeActionTextAllowed(
      "create-scenario",
      { label },
      `Name it "${label}".`,
      new Set(),
    ),
  ).toBe(true);
  expect(
    cafeActionTextAllowed(
      "create-scenario",
      { label },
      "The numbers 24 and 7 are inputs.",
      new Set(),
    ),
  ).toBe(false);
  expect(
    cafeActionTextAllowed(
      "create-scenario",
      { label },
      `Name it "${label}A".`,
      new Set(),
    ),
  ).toBe(false);
  expect(
    cafeActionTextAllowed(
      "create-scenario",
      { label },
      "",
      cafeActionTextEvidence({ toolCalls: [], toolResults: [action] }),
    ),
  ).toBe(true);
  expect(
    cafeActionTextAllowed(
      "create-scenario",
      { label },
      "",
      cafeActionTextEvidence({
        toolCalls: [],
        toolResults: [
          { ...action, isError: true },
          { ...action, name: "unknown" },
        ],
      }),
    ),
  ).toBe(false);
});

it.each([
  "Grinder wait is 999 seconds",
  "The grinder triples throughput",
  "Grinder wait is ９９９ seconds",
])(
  "rejects fabricated measurements in schema-valid text such as %s",
  (label) => {
    expect(
      cafeActionTextAllowed("create-scenario", { label }, "", new Set()),
    ).toBe(false);
    expect(
      cafeActionTextAllowed(
        "configure-shop",
        { shop: { workers: [{ name: label }] } },
        "",
        new Set(),
      ),
    ).toBe(false);
  },
);

it("preserves structured IDs, matching navigation, and a typed second-barista shift", () => {
  const id = "c8f8f5fd-0e99-43ef-bcf5-7ee870e43fe4";
  const options = {
    id,
    variantLabel: "Extra barista",
    shop: {
      workers: [
        {
          id: "barista-2",
          name: "Barista 2",
          shifts: [{ startsAt: 36_000, endsAt: 43_200 }],
        },
      ],
    },
  };
  expect(cafeActionTextAllowed("configure-shop", options, "", new Set())).toBe(
    true,
  );
  expect(
    cafeActionTextAllowed(
      "navigate",
      { path: `/cafe?scenario=${id}#service-test` },
      "",
      new Set(),
    ),
  ).toBe(true);
  expect(
    cafeActionTextAllowed(
      "navigate",
      { path: `/cafe?scenario=${id}&canary=999` },
      "",
      new Set(),
    ),
  ).toBe(false);
});

it("accepts the exact read cursor and paths backed by saved worker IDs", () => {
  const id = "c8f8f5fd-0e99-43ef-bcf5-7ee870e43fe4";
  const version = "0a99".repeat(6);
  expect(
    cafeActionTextAllowed(
      "list-scenarios",
      { catalog: { after: id, version } },
      "",
      new Set(),
    ),
  ).toBe(true);
  const input = {
    id,
    section: "chatFigures",
    path: ["shifts.worker-12.0"],
    version,
    offset: 32,
  };
  expect(
    cafeActionTextAllowed(
      "list-scenarios",
      { input },
      "",
      new Set(["worker-12"]),
    ),
  ).toBe(true);
  expect(
    cafeActionTextAllowed("list-scenarios", { input }, "", new Set()),
  ).toBe(false);
  expect(
    cafeActionTextAllowed(
      "list-scenarios",
      { input: { ...input, version: "grinder is 999 seconds" } },
      "",
      new Set(["worker-12"]),
    ),
  ).toBe(false);
});
it("keeps recognizable error categories without echoing provider codes", () => {
  expect(
    safeProviderFailure(undefined, [], {
      type: "stop",
      reason: "error",
      statusCode: 401,
      errorCode: "secret_999_seconds",
    }),
  ).toMatchObject({ errorCode: "http_401" });
  expect(
    safeProviderFailure(undefined, [], {
      type: "stop",
      reason: "error",
      errorCode: "credits-limit-secret_999_seconds",
    }),
  ).toMatchObject({ errorCode: "credits-limit" });
  const unknown = safeProviderFailure(undefined, [], {
    type: "stop",
    reason: "error",
    errorCode: "secret_999_seconds",
  });
  expect(unknown.errorCode).toBeUndefined();
  expect(JSON.stringify(unknown)).not.toContain("999");
});

it("permits only exact figures from a successful, current café action", () => {
  const quote = "215.17 seconds";
  const history = {
    toolCalls: [],
    toolResults: [
      {
        name: "compare-scenarios",
        isError: false,
        content: JSON.stringify({
          chatFigureBasis: { scenarios: [] },
          chatFigures: { wait: { text: quote } },
        }),
      },
    ],
  };
  const evidence = cafeActionTextEvidence(history);
  expect(cafeActionTextAllowed("hello", { name: quote }, "", evidence)).toBe(
    true,
  );
  expect(
    cafeActionTextAllowed("hello", { name: "215.2 seconds" }, "", evidence),
  ).toBe(false);
  expect(
    cafeActionTextAllowed(
      "hello",
      { name: "The grinder saves 215.17 seconds" },
      "",
      evidence,
    ),
  ).toBe(false);
});
