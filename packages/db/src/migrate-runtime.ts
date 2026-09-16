import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./index";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

const { client, db } = createDatabase(databaseUrl);

try {
  await migrate(db, { migrationsFolder });
} finally {
  await client.end();
}
