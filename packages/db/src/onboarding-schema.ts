import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns, organizations } from "./schema";

const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const organizationOnboarding = pgTable("organization_onboarding", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  consentConfirmedAt: timestamp("consent_confirmed_at", { withTimezone: true }),
  skippedSteps: jsonb("skipped_steps").$type<string[]>().notNull().default([]),
  testCampaignId: uuid("test_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  skippedAt: timestamp("skipped_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt,
});
