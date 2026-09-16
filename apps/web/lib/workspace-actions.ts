"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema } from "@wa/db";
import { sendAuthEmail } from "./auth-email";
import { requireAuthContext } from "./auth-context";
import { entitlements } from "./entitlements-server";
import { db } from "./server";
import { can, type WorkspaceAction } from "./workspace-access";
import { transferWorkspaceOwnershipAtomic } from "./workspace-ownership";
import { WORKSPACE_COOKIE } from "./workspace";

const editableRole = z.enum(["admin", "member", "viewer"]);
const inviteRole = editableRole;
const uuid = z.string().uuid();

function requirePermission(role: "owner" | "admin" | "member" | "viewer", action: WorkspaceAction) {
  if (!can(role, action)) throw new Error("Forbidden");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function selectWorkspaceCookie(organizationId: string) {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

async function audit(input: {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(schema.workspaceAuditLogs).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
  });
}

export async function updateWorkspaceGeneralAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "workspace.update");

  const parsed = z.object({
    organizationName: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(1).max(80),
    defaultCountry: z.string().trim().max(2),
    preferredLanguage: z.enum(["en", "ar"]),
  }).parse({
    organizationName: formData.get("organizationName"),
    timezone: formData.get("timezone"),
    defaultCountry: formData.get("defaultCountry"),
    preferredLanguage: formData.get("preferredLanguage"),
  });

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.timezone }).format(new Date());
  } catch {
    throw new Error("Invalid timezone");
  }

  const country = parsed.defaultCountry ? parsed.defaultCountry.toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("Default country must be a two-letter code");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.organizations)
      .set({ name: parsed.organizationName, updatedAt: new Date() })
      .where(eq(schema.organizations.id, workspace.organizationId));

    await tx
      .insert(schema.workspacePreferences)
      .values({
        organizationId: workspace.organizationId,
        timezone: parsed.timezone,
        defaultCountry: country,
        preferredLanguage: parsed.preferredLanguage,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.workspacePreferences.organizationId,
        set: {
          timezone: parsed.timezone,
          defaultCountry: country,
          preferredLanguage: parsed.preferredLanguage,
          updatedAt: new Date(),
        },
      });

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: workspace.organizationId,
      actorUserId: workspace.userId,
      action: "workspace.general.updated",
      targetType: "organization",
      targetId: workspace.organizationId,
      metadata: { timezone: parsed.timezone, defaultCountry: country, preferredLanguage: parsed.preferredLanguage },
    });
  });

  revalidatePath("/settings/general");
}

export async function inviteWorkspaceMemberAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "team.invite");

  const parsed = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: inviteRole,
  }).parse({ email: formData.get("email"), role: formData.get("role") });

  if (workspace.role !== "owner" && parsed.role === "admin") {
    throw new Error("Only the workspace owner can invite administrators");
  }

  const existingMember = (
    await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(and(eq(schema.organizationMembers.organizationId, workspace.organizationId), eq(schema.users.email, parsed.email)))
      .limit(1)
  )[0];
  if (existingMember) throw new Error("That user is already a workspace member");

  const [memberCount] = await db
    .select({ total: count() })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, workspace.organizationId));
  await entitlements.assertUsage(workspace.organizationId, "max_members", {
    currentUsage: memberCount?.total ?? 0,
    requested: 1,
  });

  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.organizationInvitations)
      .where(and(
        eq(schema.organizationInvitations.organizationId, workspace.organizationId),
        eq(schema.organizationInvitations.email, parsed.email),
        isNull(schema.organizationInvitations.acceptedAt),
      ));

    await tx.insert(schema.organizationInvitations).values({
      organizationId: workspace.organizationId,
      email: parsed.email,
      role: parsed.role,
      tokenHash: hash,
      invitedByUserId: workspace.userId,
      expiresAt,
    });

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: workspace.organizationId,
      actorUserId: workspace.userId,
      action: "workspace.member.invited",
      targetType: "invitation",
      targetId: parsed.email,
      metadata: { role: parsed.role, expiresAt: expiresAt.toISOString() },
    });
  });

  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  try {
    await sendAuthEmail({
      to: parsed.email,
      subject: `Invitation to ${workspace.organizationName}`,
      text: `You were invited to join ${workspace.organizationName} as ${parsed.role}. Open ${baseUrl}/invite/${token} while signed in as ${parsed.email}. This invitation expires in 7 days.`,
    });
  } catch (error) {
    await db.delete(schema.organizationInvitations).where(eq(schema.organizationInvitations.tokenHash, hash));
    throw error;
  }

  revalidatePath("/settings/team");
}

export async function acceptWorkspaceInvitationAction(formData: FormData) {
  const { session, workspace } = await requireAuthContext();
  const token = z.string().min(20).max(200).parse(formData.get("token"));
  const hash = tokenHash(token);
  const now = new Date();

  const invitation = (
    await db
      .select({
        id: schema.organizationInvitations.id,
        organizationId: schema.organizationInvitations.organizationId,
        organizationName: schema.organizations.name,
        email: schema.organizationInvitations.email,
        role: schema.organizationInvitations.role,
      })
      .from(schema.organizationInvitations)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationInvitations.organizationId))
      .where(and(
        eq(schema.organizationInvitations.tokenHash, hash),
        isNull(schema.organizationInvitations.acceptedAt),
        gt(schema.organizationInvitations.expiresAt, now),
      ))
      .limit(1)
  )[0];

  if (!invitation) throw new Error("Invitation is invalid or expired");
  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    throw new Error("This invitation belongs to a different email address");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`entitlement:max_members:${invitation.organizationId}`})::bigint)`);

    const membership = (
      await tx
        .select({ id: schema.organizationMembers.id, role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .where(and(
          eq(schema.organizationMembers.organizationId, invitation.organizationId),
          eq(schema.organizationMembers.userId, workspace.userId),
        ))
        .limit(1)
    )[0];

    if (!membership) {
      const [memberCount] = await tx
        .select({ total: count() })
        .from(schema.organizationMembers)
        .where(eq(schema.organizationMembers.organizationId, invitation.organizationId));
      await entitlements.assertUsage(invitation.organizationId, "max_members", {
        currentUsage: memberCount?.total ?? 0,
        requested: 1,
      });

      await tx.insert(schema.organizationMembers).values({
        organizationId: invitation.organizationId,
        userId: workspace.userId,
        role: invitation.role === "owner" ? "member" : invitation.role,
      });
    }

    await tx
      .update(schema.organizationInvitations)
      .set({ acceptedAt: now })
      .where(eq(schema.organizationInvitations.id, invitation.id));

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: invitation.organizationId,
      actorUserId: workspace.userId,
      action: "workspace.member.invitation_accepted",
      targetType: "user",
      targetId: workspace.userId,
      metadata: { invitationId: invitation.id },
    });
  });

  await selectWorkspaceCookie(invitation.organizationId);
  redirect("/settings/team");
}

export async function changeWorkspaceMemberRoleAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "team.changeRole");
  const membershipId = uuid.parse(formData.get("membershipId"));
  const role = editableRole.parse(formData.get("role"));

  const target = (
    await db
      .select({ id: schema.organizationMembers.id, userId: schema.organizationMembers.userId, role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.id, membershipId),
        eq(schema.organizationMembers.organizationId, workspace.organizationId),
      ))
      .limit(1)
  )[0];
  if (!target) throw new Error("Member not found");
  if (target.role === "owner") throw new Error("Transfer ownership instead of changing the owner role");
  if (target.userId === workspace.userId) throw new Error("You cannot change your own role");
  if (workspace.role !== "owner" && (target.role === "admin" || role === "admin")) {
    throw new Error("Only the workspace owner can manage administrators");
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.organizationMembers).set({ role }).where(eq(schema.organizationMembers.id, target.id));
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: workspace.organizationId,
      actorUserId: workspace.userId,
      action: "workspace.member.role_changed",
      targetType: "membership",
      targetId: target.id,
      metadata: { from: target.role, to: role },
    });
  });
  revalidatePath("/settings/team");
}

export async function removeWorkspaceMemberAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "team.remove");
  const membershipId = uuid.parse(formData.get("membershipId"));

  const target = (
    await db
      .select({ id: schema.organizationMembers.id, userId: schema.organizationMembers.userId, role: schema.organizationMembers.role })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.id, membershipId),
        eq(schema.organizationMembers.organizationId, workspace.organizationId),
      ))
      .limit(1)
  )[0];
  if (!target) throw new Error("Member not found");
  if (target.role === "owner") throw new Error("Transfer ownership before removing the owner");
  if (target.userId === workspace.userId) throw new Error("You cannot remove yourself from this workspace");
  if (workspace.role !== "owner" && target.role === "admin") {
    throw new Error("Only the workspace owner can remove administrators");
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.organizationMembers).where(eq(schema.organizationMembers.id, target.id));
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: workspace.organizationId,
      actorUserId: workspace.userId,
      action: "workspace.member.removed",
      targetType: "user",
      targetId: target.userId,
      metadata: { role: target.role },
    });
  });
  revalidatePath("/settings/team");
}

export async function transferWorkspaceOwnershipAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "team.transferOwnership");
  const membershipId = uuid.parse(formData.get("membershipId"));

  await transferWorkspaceOwnershipAtomic(db, {
    organizationId: workspace.organizationId,
    actorUserId: workspace.userId,
    targetMembershipId: membershipId,
  });
  revalidatePath("/settings/team");
}

export async function switchWorkspaceAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  const organizationId = uuid.parse(formData.get("organizationId"));
  const membership = (
    await db
      .select({ id: schema.organizationMembers.id })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.userId, workspace.userId),
      ))
      .limit(1)
  )[0];
  if (!membership) throw new Error("Workspace not found");
  await selectWorkspaceCookie(organizationId);
  redirect("/settings/general");
}

export async function disconnectWhatsAppNumberAction(formData: FormData) {
  const { workspace } = await requireAuthContext();
  requirePermission(workspace.role, "whatsapp.manage");
  const phoneNumberId = uuid.parse(formData.get("phoneNumberId"));

  const phone = (
    await db
      .select({ id: schema.whatsappPhoneNumbers.id, credentialKey: schema.whatsappPhoneNumbers.credentialKey, status: schema.whatsappPhoneNumbers.status })
      .from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.id, phoneNumberId),
        eq(schema.whatsappPhoneNumbers.organizationId, workspace.organizationId),
      ))
      .limit(1)
  )[0];
  if (!phone) throw new Error("WhatsApp number not found");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.whatsappPhoneNumbers)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(schema.whatsappPhoneNumbers.id, phone.id));
    await tx
      .delete(schema.credentialSecrets)
      .where(and(
        eq(schema.credentialSecrets.organizationId, workspace.organizationId),
        eq(schema.credentialSecrets.key, phone.credentialKey),
      ));
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: workspace.organizationId,
      actorUserId: workspace.userId,
      action: "whatsapp.disconnected",
      targetType: "whatsapp_phone_number",
      targetId: phone.id,
      metadata: { previousStatus: phone.status },
    });
  });

  revalidatePath("/settings/whatsapp");
}
