import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as coreSchema from "./schema";
import * as contactImportSchema from "./contact-import-schema";

export const schema = { ...coreSchema, ...contactImportSchema };
export * from "./schema";
export * from "./contact-import-schema";

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
