"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createBillingAdminService } from "@wa/billing";
import { schema } from "@wa/db";
import { requirePlatformAdmin } from "./platform-admin";
import { db } from "./server";

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function actorAppUserId(authUserId: string): Promise<string | null> {
  return db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.externalAuthId, authUserId)).limit(1).then((rows) => rows[0]?.id ?? null);
}

function refreshBilling(organizationId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath("/admin/audit");
}

export async function changeBillingPlanAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requiredText(formData, "organizationId");
  const subscriptionId = requiredText(formData, "subscriptionId");
  const planVersionId = requiredText(formData, "planVersionId");

  const [subscription] = await db.select({
    id: schema.billingSubscriptions.id,
    isManual: schema.billingSubscriptions.isManual,
    currentPlanVersionId: schema.billingSubscriptions.planVersionId,
  }).from(schema.billingSubscriptions).where(and(
    eq(schema.billingSubscriptions.id, subscriptionId),
    eq(schema.billingSubscriptions.organizationId, organizationId),
  )).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  if (!subscription.isManual) throw new Error("Provider-managed subscriptions must be changed through the billing provider");

  const [targetPlan] = await db.select({
    id: schema.billingPlanVersions.id,
    code: schema.billingPlans.code,
    active: schema.billingPlans.isActive,
    planOrganizationId: schema.billingPlans.organizationId,
  }).from(schema.billingPlanVersions)
    .innerJoin(schema.billingPlans, eq(schema.billingPlans.id, schema.billingPlanVersions.planId))
    .where(eq(schema.billingPlanVersions.id, planVersionId))
    .limit(1);
  if (!targetPlan || !targetPlan.active) throw new Error("Active plan version not found");
  if (targetPlan.planOrganizationId && targetPlan.planOrganizationId !== organizationId) throw new Error("Custom plan belongs to another organization");
  if (subscription.currentPlanVersionId === targetPlan.id) return;

  const billing = createBillingAdminService(db);
  await billing.changePlan({
    organizationId,
    subscriptionId,
    planVersionId,
    actorUserId: await actorAppUserId(actor.authUserId),
  });
  await db.insert(schema.platformAuditEvents).values({
    actorAuthUserId: actor.authUserId,
    organizationId,
    action: "billing.plan_changed_by_platform_admin",
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { fromPlanVersionId: subscription.currentPlanVersionId, toPlanVersionId: targetPlan.id, planCode: targetPlan.code },
  });

  refreshBilling(organizationId);
}

export async function suspendBillingSubscriptionAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requiredText(formData, "organizationId");
  const subscriptionId = requiredText(formData, "subscriptionId");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || "Suspended by platform administrator";

  const [subscription] = await db.select({
    id: schema.billingSubscriptions.id,
    status: schema.billingSubscriptions.status,
    isManual: schema.billingSubscriptions.isManual,
  }).from(schema.billingSubscriptions).where(and(
    eq(schema.billingSubscriptions.id, subscriptionId),
    eq(schema.billingSubscriptions.organizationId, organizationId),
  )).limit(1);
  if (!subscription) throw new Error("Subscription not found");
  if (!subscription.isManual) throw new Error("Provider-managed subscriptions must be controlled through the billing provider");
  if (subscription.status === "suspended") return;
  if (subscription.status === "cancelled") throw new Error("Cancelled subscriptions cannot be suspended");

  const billing = createBillingAdminService(db);
  await billing.suspendSubscription({
    organizationId,
    subscriptionId,
    actorUserId: await actorAppUserId(actor.authUserId),
    reason,
  });
  await db.insert(schema.platformAuditEvents).values({
    actorAuthUserId: actor.authUserId,
    organizationId,
    action: "billing.subscription_suspended_by_platform_admin",
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { previousStatus: subscription.status, reason },
  });

  refreshBilling(organizationId);
}
