import { createAppAuth } from "@wa/auth";
import { createDatabase } from "@wa/db";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const database = createDatabase(requiredEnv("DATABASE_URL"));

export const db = database.db;
export const databaseClient = database.client;

export const auth = createAppAuth({
  db,
  baseUrl: requiredEnv("BETTER_AUTH_URL"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
});

export function getMetaServerConfig() {
  return {
    appId: requiredEnv("META_APP_ID"),
    appSecret: requiredEnv("META_APP_SECRET"),
    configId: requiredEnv("META_CONFIG_ID"),
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v26.0",
  };
}

export function getCredentialEncryptionKey(): string {
  return requiredEnv("CREDENTIAL_ENCRYPTION_KEY");
}
