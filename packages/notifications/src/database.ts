import type { createDatabase } from "@wa/db";

export type NotificationDatabase = ReturnType<typeof createDatabase>["db"];
