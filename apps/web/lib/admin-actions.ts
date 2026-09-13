"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@wa/db";
import { requirePlatformAdmin } from "./platform-admin";
import { db } from "./server";

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalLimit(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
}

function refreshOrganization(id: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${id}`);
  revalidatePath("/admin/audit");
}

export async function suspendOrganizationAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requiredText(formData, "organizationId");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || "Suspended by platform administrator";
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.organizationAdminSettings)
      .values({ organizationId, status: "suspended", suspendedAt: now, suspendedReason: reason, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.organizationAdminSettings.organizationId,
        set: { status: "suspended", suspendedAt: now, suspendedReason: reason, updatedAt: now },
      });
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId,
      action: "organization.suspended",
      targetType: "organization",
      targetId: organizationId,
      metadata: { reason },
    });
  });

  refreshOrganization(organizationId);
}

export async function reactivateOrganizationAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requiredText(formData, "organizationId");
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.organizationAdminSettings)
      .values({ organizationId, status: "active", suspendedAt: null, suspendedReason: null, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.organizationAdminSettings.organizationId,
        set: { status: "active", suspendedAt: null, suspendedReason: null, updatedAt: now },
      });
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId,
      action: "organization.reactivated",
      targetType: "organization",
      targetId: organizationId,
      metadata: {},
    });
  });

  refreshOrganization(organizationId);
}

export async function updateOrganizationPlanAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const organizationId = requiredText(formData, "organizationId");
  const plan = requiredText(formData, "plan").slice(0, 80);
  const contactLimit = optionalLimit(formData, "contactLimit");
  const campaignRecipientLimit = optionalLimit(formData, "campaignRecipientLimit");
  const monthlyMessageLimit = optionalLimit(formData, "monthlyMessageLimit");
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.organizationAdminSettings)
      .values({ organizationId, plan, contactLimit, campaignRecipientLimit, monthlyMessageLimit, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.organizationAdminSettings.organizationId,
        set: { plan, contactLimit, campaignRecipientLimit, monthlyMessageLimit, updatedAt: now },
      });
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId,
      action: "organization.plan_limits_changed",
      targetType: "organization",
      targetId: organizationId,
      metadata: { plan, contactLimit, campaignRecipientLimit, monthlyMessageLimit },
    });
  });

  refreshOrganization(organizationId);
}

export async function setUserDisabledAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const userId = requiredText(formData, "userId");
  const disabled = requiredText(formData, "disabled") === "true";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  const now = new Date();
  const user = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1))[0];
  if (!user) throw new Error("User not found");

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.platformUserControls)
      .values({ userId, disabled, disabledAt: disabled ? now : null, disabledReason: disabled ? reason : null, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.platformUserControls.userId,
        set: { disabled, disabledAt: disabled ? now : null, disabledReason: disabled ? reason : null, updatedAt: now },
      });
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      action: disabled ? "user.disabled" : "user.reenabled",
      targetType: "user",
      targetId: userId,
      metadata: { reason },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
}
