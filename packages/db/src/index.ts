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
};
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
export * from "./audience-query";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}
