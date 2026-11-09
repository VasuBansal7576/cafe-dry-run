import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    name: "cafe-scenarios",
    sql: `CREATE TABLE IF NOT EXISTS cafe_scenarios (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      base_hourly_demand INTEGER NOT NULL CHECK (base_hourly_demand BETWEEN 0 AND 1000),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    );
    CREATE INDEX IF NOT EXISTS cafe_scenarios_owner_idx ON cafe_scenarios (owner_email);`,
  },
], { table: "cafe_app_migrations" });
