import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as coreSchema from "./schema";
import * as contactImportSchema from "./contact-import-schema";
import * as suppressionSchema from "./suppression-schema";
import * as audienceSchema from "./audience-schema";
import * as adminSchema from "./admin-schema";
import * as workspaceSettingsSchema from "./workspace-settings-schema";
import * as billingSchema from "./billing-schema";
import * as onboardingSchema from "./onboarding-schema";
import * as notificationSchema from "./notification-schema";
import * as dataLifecycleSchema from "./data-lifecycle-schema";
import * as legalSchema from "./legal-schema";
import * as metaAssetSchema from "./meta-asset-schema";
import * as inboxSchema from "./inbox-schema";

export const schema = {
  ...coreSchema,
  ...contactImportSchema,
  ...suppressionSchema,
  ...audienceSchema,
  ...adminSchema,
  ...workspaceSettingsSchema,
  ...billingSchema,
  ...onboardingSchema,
  ...notificationSchema,
  ...dataLifecycleSchema,
  ...legalSchema,
  ...metaAssetSchema,
  ...inboxSchema,
};
export type Database = ReturnType<typeof createDatabase>["db"];
export * from "./schema";
export * from "./contact-import-schema";
export * from "./suppression-schema";
export * from "./audience-schema";
export * from "./admin-schema";
export * from "./workspace-settings-schema";
export * from "./billing-schema";
export * from "./onboarding-schema";
export * from "./notification-schema";
export * from "./data-lifecycle-schema";
export * from "./legal-schema";
export * from "./meta-asset-schema";
export * from "./inbox-schema";
export * from "./audience-query";
export * from "./campaign-control";

export type DatabaseOptions = {
  maxConnections?: number;
};

export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}) {
  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}
