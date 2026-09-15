import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@wa/db";
import { addMonths, billingAuditActions, type BillingDb } from "./shared";

export async function ensureDefaultBilling(db: BillingDb, organizationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`);

    let account = (
      await tx
        .select()
        .from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.organizationId, organizationId))
        .limit(1)
    )[0];

    if (!account) {
      account = (
        await tx.insert(schema.billingAccounts).values({ organizationId }).returning()
      )[0];
    }
    if (!account) throw new Error("Could not initialize billing account");

    const existing = (
      await tx
        .select({ id: schema.billingSubscriptions.id })
        .from(schema.billingSubscriptions)
        .where(eq(schema.billingSubscriptions.organizationId, organizationId))
        .limit(1)
    )[0];
    if (existing) return;

    const starter = (
      await tx
        .select({ planVersionId: schema.billingPlanVersions.id })
        .from(schema.billingPlanVersions)
        .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
        .where(and(eq(schema.billingPlans.code, "starter"), eq(schema.billingPlans.isActive, true)))
        .orderBy(desc(schema.billingPlanVersions.version))
        .limit(1)
    )[0];
    if (!starter) throw new Error("Starter billing plan is not configured");

    const now = new Date();
    const subscription = (
      await tx
        .insert(schema.billingSubscriptions)
        .values({
          billingAccountId: account.id,
          organizationId,
          planVersionId: starter.planVersionId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
        })
        .returning({ id: schema.billingSubscriptions.id })
    )[0];
    if (!subscription) throw new Error("Could not initialize subscription");

    await tx.insert(schema.billingSubscriptionChanges).values({
      organizationId,
      subscriptionId: subscription.id,
      toPlanVersionId: starter.planVersionId,
      toStatus: "active",
      kind: "activation",
      metadata: { source: "workspace_bootstrap" },
    });

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId,
      action: billingAuditActions.subscriptionActivated,
      targetType: "subscription",
      targetId: subscription.id,
      metadata: { source: "workspace_bootstrap" },
    });
  });
}
