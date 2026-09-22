import { desc, eq } from "drizzle-orm";
import type { createDatabase } from "@wa/db";
import { schema } from "@wa/db";

export type BillingDb = ReturnType<typeof createDatabase>["db"];

export const billingAuditActions = {
  planChanged: "billing.plan_changed",
  subscriptionActivated: "billing.subscription_activated",
  subscriptionCancelled: "billing.subscription_cancelled",
  subscriptionSuspended: "billing.subscription_suspended",
  manualOverride: "billing.manual_override",
} as const;

type BillingAuditAction = (typeof billingAuditActions)[keyof typeof billingAuditActions];

export function addMonths(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "custom";
}

export async function billingAccountFor(db: BillingDb, organizationId: string) {
  const existing = (
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (existing) return existing;

  const inserted = await db
    .insert(schema.billingAccounts)
    .values({ organizationId })
    .onConflictDoNothing({ target: schema.billingAccounts.organizationId })
    .returning();
  if (inserted[0]) return inserted[0];

  const concurrent = (
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1)
  )[0];
  if (!concurrent) throw new Error("Could not create billing account");
  return concurrent;
}

export async function auditBillingAction(
  db: BillingDb,
  input: {
    organizationId: string;
    actorUserId: string | null;
    action: BillingAuditAction;
    targetType: string;
    targetId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  await db.insert(schema.workspaceAuditLogs).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

export async function currentSubscription(db: BillingDb, organizationId: string) {
  return (
    await db
      .select()
      .from(schema.billingSubscriptions)
      .where(eq(schema.billingSubscriptions.organizationId, organizationId))
      .orderBy(desc(schema.billingSubscriptions.createdAt))
      .limit(1)
  )[0] ?? null;
}
