import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const scenarios = pgTable("cafe_scenarios", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  baseHourlyDemand: integer("base_hourly_demand").notNull(),
  revision: integer("revision").notNull().default(0),
});
