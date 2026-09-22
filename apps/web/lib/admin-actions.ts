"use server";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@wa/db";
import { requirePlatformAdminMutation } from "./platform-admin";
import { db } from "./server";

const workspaceRoles = new Set(["owner", "admin", "member", "viewer"]);

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
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
}

function refreshAccess() {
  revalidatePath("/admin");
  revalidatePath("/admin/access");
  revalidatePath("/admin/audit");
}

export async function grantPlatformAdminAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
  const targetAuthUserId = requiredText(formData, "authUserId");
  const [target] = await db
    .select({ id: schema.authUser.id, email: schema.authUser.email })
    .from(schema.authUser)
    .where(eq(schema.authUser.id, targetAuthUserId))
    .limit(1);
  if (!target) throw new Error("Authentication user not found");

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.platformAdminGrants)
      .values({
        authUserId: target.id,
        source: "manual",
        createdByAuthUserId: actor.authUserId,
        revokedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.platformAdminGrants.authUserId,
        set: {
          source: "manual",
          createdByAuthUserId: actor.authUserId,
          revokedAt: null,
          updatedAt: now,
        },
      });
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      action: "platform_admin.granted",
      targetType: "auth_user",
      targetId: target.id,
      metadata: { email: target.email },
    });
  });

  refreshAccess();
}

export async function revokePlatformAdminAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
  const targetAuthUserId = requiredText(formData, "authUserId");
  if (targetAuthUserId === actor.authUserId) {
    throw new Error("You cannot revoke your own platform-admin grant");
  }

  const [target] = await db
    .select({
      id: schema.authUser.id,
      email: schema.authUser.email,
      revokedAt: schema.platformAdminGrants.revokedAt,
    })
    .from(schema.authUser)
    .innerJoin(schema.platformAdminGrants, eq(schema.platformAdminGrants.authUserId, schema.authUser.id))
    .where(eq(schema.authUser.id, targetAuthUserId))
    .limit(1);
  if (!target || target.revokedAt) throw new Error("Active platform-admin grant not found");

  const now = new Date();
  await db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(schema.platformAdminGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(schema.platformAdminGrants.authUserId, target.id), isNull(schema.platformAdminGrants.revokedAt)))
      .returning({ id: schema.platformAdminGrants.id });
    if (!revoked) throw new Error("Platform-admin grant changed while revoking; refresh and try again");

    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      action: "platform_admin.revoked",
      targetType: "auth_user",
      targetId: target.id,
      metadata: { email: target.email },
    });
  });

  refreshAccess();
}

export async function suspendOrganizationAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
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
  const actor = await requirePlatformAdminMutation();
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
  const actor = await requirePlatformAdminMutation();
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

export async function updateMembershipRoleAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
  const membershipId = requiredText(formData, "membershipId");
  const role = requiredText(formData, "role");
  if (!workspaceRoles.has(role)) throw new Error("Invalid workspace role");

  const [membershipRef] = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.id, membershipId))
    .limit(1);
  if (!membershipRef) throw new Error("Membership not found");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.organizations.id} from ${schema.organizations} where ${schema.organizations.id} = ${membershipRef.organizationId} for update`);

    const [membership] = await tx
      .select({
        id: schema.organizationMembers.id,
        organizationId: schema.organizationMembers.organizationId,
        userId: schema.organizationMembers.userId,
        currentRole: schema.organizationMembers.role,
        email: schema.users.email,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.id, membershipId))
      .limit(1);
    if (!membership) throw new Error("Membership not found");
    if (membership.currentRole === role) return;

    if (membership.currentRole === "owner" && role !== "owner") {
      const [owners] = await tx
        .select({ value: count() })
        .from(schema.organizationMembers)
        .where(and(eq(schema.organizationMembers.organizationId, membership.organizationId), eq(schema.organizationMembers.role, "owner")));
      if ((owners?.value ?? 0) <= 1) throw new Error("An organization must retain at least one owner");
    }

    await tx
      .update(schema.organizationMembers)
      .set({ role: role as "owner" | "admin" | "member" | "viewer" })
      .where(eq(schema.organizationMembers.id, membership.id));
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId: membership.organizationId,
      action: "membership.role_changed",
      targetType: "organization_membership",
      targetId: membership.id,
      metadata: { userId: membership.userId, email: membership.email, fromRole: membership.currentRole, toRole: role },
    });
  });

  refreshOrganization(membershipRef.organizationId);
}

export async function removeMembershipAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
  const membershipId = requiredText(formData, "membershipId");

  const [membershipRef] = await db
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.id, membershipId))
    .limit(1);
  if (!membershipRef) throw new Error("Membership not found");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select ${schema.organizations.id} from ${schema.organizations} where ${schema.organizations.id} = ${membershipRef.organizationId} for update`);

    const [membership] = await tx
      .select({
        id: schema.organizationMembers.id,
        organizationId: schema.organizationMembers.organizationId,
        userId: schema.organizationMembers.userId,
        role: schema.organizationMembers.role,
        email: schema.users.email,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.id, membershipId))
      .limit(1);
    if (!membership) throw new Error("Membership not found");

    if (membership.role === "owner") {
      const [owners] = await tx
        .select({ value: count() })
        .from(schema.organizationMembers)
        .where(and(eq(schema.organizationMembers.organizationId, membership.organizationId), eq(schema.organizationMembers.role, "owner")));
      if ((owners?.value ?? 0) <= 1) throw new Error("The last organization owner cannot be removed");
    }

    await tx.delete(schema.organizationMembers).where(eq(schema.organizationMembers.id, membership.id));
    await tx.insert(schema.platformAuditEvents).values({
      actorAuthUserId: actor.authUserId,
      organizationId: membership.organizationId,
      action: "membership.removed",
      targetType: "organization_membership",
      targetId: membership.id,
      metadata: { userId: membership.userId, email: membership.email, role: membership.role },
    });
  });

  refreshOrganization(membershipRef.organizationId);
}

export async function setUserDisabledAction(formData: FormData) {
  const actor = await requirePlatformAdminMutation();
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
  revalidatePath("/admin/access");
  revalidatePath("/admin/audit");
}
