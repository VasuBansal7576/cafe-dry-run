import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
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
    {
      version: 2,
      name: "cafe-service-inputs-and-runs",
      sql: `ALTER TABLE cafe_scenarios
      ADD COLUMN demand JSONB,
      ADD COLUMN shop JSONB,
      ADD COLUMN latest_run_id TEXT,
      ADD CONSTRAINT cafe_scenarios_id_owner_key UNIQUE (id, owner_email);
    CREATE TABLE cafe_service_runs (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      scenario_revision INTEGER NOT NULL CHECK (scenario_revision >= 0),
      summary JSONB NOT NULL,
      playback JSONB NOT NULL,
      CONSTRAINT cafe_service_runs_scenario_owner_fkey FOREIGN KEY (scenario_id, owner_email)
        REFERENCES cafe_scenarios (id, owner_email) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX cafe_service_runs_scenario_idx ON cafe_service_runs (scenario_id);`,
    },
    {
      version: 3,
      name: "cafe-scenario-spot",
      sql: `ALTER TABLE cafe_scenarios
      ADD COLUMN spot JSONB NOT NULL DEFAULT '{"label":"12th Main & 5th Cross","lat":12.9700379,"lon":77.6387736}'::jsonb,
      ADD COLUMN spot_revision INTEGER NOT NULL DEFAULT 0 CHECK (spot_revision >= 0);
    ALTER TABLE cafe_scenarios ALTER COLUMN spot DROP DEFAULT;`,
    },
  ],
  { table: "cafe_app_migrations" },
);
