import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  unique,
} from "drizzle-orm/pg-core";

import type { DecisionReceipt } from "../lib/cafe/decision-receipt.js";
import type { ScenarioFinance } from "../lib/cafe/finance.js";
import type { ScenarioDemand, ScenarioShop } from "../lib/cafe/scenario.js";
import type { ServiceRun } from "../lib/cafe/service-run.js";

export const scenarios = pgTable(
  "cafe_scenarios",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    baseHourlyDemand: integer("base_hourly_demand").notNull(),
    revision: integer("revision").notNull().default(0),
    demand: jsonb("demand").$type<ScenarioDemand>(),
    shop: jsonb("shop").$type<ScenarioShop>(),
    latestRunId: text("latest_run_id"),
    label: text("label").notNull().default("One barista"),
    parentId: text("parent_id"),
    finance: jsonb("finance").$type<ScenarioFinance>(),
    financeRevision: integer("finance_revision").notNull().default(0),
  },
  (table) => [
    unique("cafe_scenarios_id_owner_key").on(table.id, table.ownerEmail),
  ],
);

export const serviceRuns = pgTable(
  "cafe_service_runs",
  {
    id: text("id").primaryKey(),
    scenarioId: text("scenario_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    scenarioRevision: integer("scenario_revision").notNull(),
    summary: jsonb("summary").$type<ServiceRun["summary"]>().notNull(),
    playback: jsonb("playback").$type<ServiceRun["playback"]>().notNull(),
  },
  (table) => [
    foreignKey({
      name: "cafe_service_runs_scenario_owner_fkey",
      columns: [table.scenarioId, table.ownerEmail],
      foreignColumns: [scenarios.id, scenarios.ownerEmail],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const decisionRuns = pgTable(
  "cafe_decision_runs",
  {
    id: text("id").primaryKey(),
    sequence: serial("sequence").notNull(),
    ownerEmail: text("owner_email").notNull(),
    aScenarioId: text("a_scenario_id").notNull(),
    bScenarioId: text("b_scenario_id"),
    receipt: jsonb("receipt").$type<DecisionReceipt>().notNull(),
  },
  (table) => [
    foreignKey({
      name: "cafe_decision_runs_a_owner_fkey",
      columns: [table.aScenarioId, table.ownerEmail],
      foreignColumns: [scenarios.id, scenarios.ownerEmail],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "cafe_decision_runs_b_owner_fkey",
      columns: [table.bScenarioId, table.ownerEmail],
      foreignColumns: [scenarios.id, scenarios.ownerEmail],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);
