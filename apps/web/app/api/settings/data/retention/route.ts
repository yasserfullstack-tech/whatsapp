import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { entitlements, entitlementErrorPayload } from "@/lib/entitlements-server";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

const policySchema = z.object({
  rawWebhookDays: z.number().int().min(1).max(365),
  importFileDays: z.number().int().min(1).max(90),
  exportFileHours: z.number().int().min(1).max(168),
  auditLogDays: z.number().int().min(30).max(2555),
  campaignRecipientDays: z.number().int().min(30).max(2555),
});
const defaults = { rawWebhookDays: 30, importFileDays: 7, exportFileHours: 24, auditLogDays: 365, campaignRecipientDays: 365 };

async function effectivePolicy(organizationId: string, policy: typeof defaults) {
  const [auditLimit, analyticsLimit] = await Promise.all([
    entitlements.getLimit(organizationId, "audit_retention_days"),
    entitlements.getLimit(organizationId, "analytics_retention_days"),
  ]);

  return {
    ...policy,
    auditLogDays: auditLimit === null ? policy.auditLogDays : Math.min(policy.auditLogDays, auditLimit ?? 30),
    // Campaign recipient history is the source retained for campaign analytics.
    campaignRecipientDays: analyticsLimit === null
      ? policy.campaignRecipientDays
      : Math.min(policy.campaignRecipientDays, analyticsLimit ?? 30),
  };
}

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const row = (await db.select().from(schema.dataRetentionPolicies)
    .where(eq(schema.dataRetentionPolicies.organizationId, context.workspace.organizationId)).limit(1))[0];
  const policy = await effectivePolicy(context.workspace.organizationId, row ?? defaults);
  return NextResponse.json(policy, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.retention")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = policySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid retention policy", issues: parsed.error.issues }, { status: 400 });

  try {
    await Promise.all([
      entitlements.assertUsage(context.workspace.organizationId, "audit_retention_days", {
        requested: parsed.data.auditLogDays,
      }),
      entitlements.assertUsage(context.workspace.organizationId, "analytics_retention_days", {
        requested: parsed.data.campaignRecipientDays,
      }),
    ]);
  } catch (error) {
    const payload = entitlementErrorPayload(error);
    if (payload) return NextResponse.json(payload, { status: 409 });
    throw error;
  }

  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.dataRetentionPolicies).values({ organizationId: context.workspace.organizationId, ...parsed.data, updatedAt })
      .onConflictDoUpdate({ target: schema.dataRetentionPolicies.organizationId, set: { ...parsed.data, updatedAt } });
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      action: "data.retention.updated",
      targetType: "organization",
      targetId: context.workspace.organizationId,
      metadata: parsed.data,
    });
    await tx.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      actorAuthUserId: context.session.user.id,
      action: "retention.updated",
      targetType: "organization",
      targetId: context.workspace.organizationId,
      metadata: parsed.data,
    });
  });
  return NextResponse.json({ ...parsed.data, updatedAt: updatedAt.toISOString() });
}
