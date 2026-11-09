import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

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
