import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/schema.ts",
    "./src/contact-import-schema.ts",
    "./src/suppression-schema.ts",
    "./src/audience-schema.ts",
    "./src/admin-schema.ts",
    "./src/workspace-settings-schema.ts",
    "./src/notification-schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: false,
});
