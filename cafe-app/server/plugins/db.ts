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
      version: 4,
      name: "cafe-comparisons-and-runway",
      sql: `ALTER TABLE cafe_scenarios
      ADD COLUMN label TEXT NOT NULL DEFAULT 'One barista',
      ADD COLUMN parent_id TEXT,
      ADD COLUMN finance JSONB,
      ADD COLUMN finance_revision INTEGER NOT NULL DEFAULT 0 CHECK (finance_revision >= 0);
    CREATE TABLE cafe_decision_runs (
      id TEXT PRIMARY KEY,
      sequence SERIAL NOT NULL,
      owner_email TEXT NOT NULL,
      a_scenario_id TEXT NOT NULL,
      b_scenario_id TEXT,
      receipt JSONB NOT NULL,
      CONSTRAINT cafe_decision_runs_a_owner_fkey FOREIGN KEY (a_scenario_id, owner_email)
        REFERENCES cafe_scenarios (id, owner_email) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT cafe_decision_runs_b_owner_fkey FOREIGN KEY (b_scenario_id, owner_email)
        REFERENCES cafe_scenarios (id, owner_email) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX cafe_decision_runs_scope_idx
      ON cafe_decision_runs (owner_email, a_scenario_id, b_scenario_id, sequence DESC);`,
    },
    {
      version: 5,
      name: "cafe-service-arrival-source",
      sql: `ALTER TABLE cafe_service_runs
      ADD COLUMN arrival_source_id TEXT,
      ADD COLUMN arrival_source_revision INTEGER;
    UPDATE cafe_service_runs AS r
      SET arrival_source_id = r.scenario_id, arrival_source_revision = r.scenario_revision;
    UPDATE cafe_service_runs AS r
      SET arrival_source_id = d.a_scenario_id,
          arrival_source_revision = (d.receipt->'a'->'service'->>'scenarioRevision')::integer
      FROM cafe_decision_runs AS d
      WHERE r.owner_email = d.owner_email AND r.id = d.receipt->'b'->'service'->>'id';
    ALTER TABLE cafe_service_runs
      ALTER COLUMN arrival_source_id SET NOT NULL,
      ALTER COLUMN arrival_source_revision SET NOT NULL,
      ADD CHECK (arrival_source_revision >= 0);`,
    },
  ],
  { table: "cafe_app_migrations" },
);
