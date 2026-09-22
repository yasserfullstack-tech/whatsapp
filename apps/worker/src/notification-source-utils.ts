import { and, eq, inArray } from "drizzle-orm";
import { createDatabase, schema } from "@wa/db";
import { NotificationService, type NotificationType } from "@wa/notifications";

export type Database = ReturnType<typeof createDatabase>["db"];
export type NotificationEmitter = Pick<NotificationService, "emit">;
export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function qualityRank(value: string | null | undefined): number | null {
  switch (value?.trim().toUpperCase()) {
    case "GREEN": return 3;
    case "YELLOW": return 2;
    case "RED": return 1;
    default: return null;
  }
}

export function isQualityDegraded(before: string | null | undefined, after: string | null | undefined): boolean {
  const previous = qualityRank(before);
  const next = qualityRank(after);
  return previous !== null && next !== null && next < previous;
}

export function templateNotificationType(status: string | null | undefined): NotificationType | null {
  switch (status?.trim().toLowerCase()) {
    case "approved": return "template_approved";
    case "rejected": return "template_rejected";
    default: return null;
  }
}

export function subscriptionNotificationType(toStatus: string | null | undefined): NotificationType {
  return toStatus === "past_due" || toStatus === "grace_period"
    ? "subscription_past_due"
    : "subscription_changed";
}

export function usagePercent(quantity: number, limit: number | null): number | null {
  if (limit === null || limit <= 0 || quantity < 0) return null;
  return Math.floor((quantity / limit) * 100);
}

export async function adminUserIds(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(and(
      eq(schema.organizationMembers.organizationId, organizationId),
      inArray(schema.organizationMembers.role, ["owner", "admin"]),
    ));
  return rows.map((row) => row.userId);
}
