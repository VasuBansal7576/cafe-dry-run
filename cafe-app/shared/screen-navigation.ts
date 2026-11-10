export const screenPaths = {
  cafe: "/cafe",
  home: "/home",
  chat: "/chat",
  database: "/database",
  extensions: "/extensions",
  observability: "/observability",
  agent: "/settings/agent",
  settings: "/settings",
} as const;

export type ScreenView = keyof typeof screenPaths;

export const cafeDocuments = [
  "opening-file",
  "site-demand",
  "service-test",
  "cash-ledger",
] as const;

export type CafeDocument = (typeof cafeDocuments)[number];
