import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { workspaceDeletionSchedule } from "@/lib/data-lifecycle";
import { getAuthContext } from "@/lib/auth-context";
import { hasRecentAuthentication } from "@/lib/recent-auth";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

function recentAuthError() {
  return NextResponse.json({ error: "Recent authentication required. Sign out and sign back in before retrying." }, { status: 428 });
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.deleteWorkspace")) return NextResponse.json({ error: "Workspace deletion is owner-only" }, { status: 403 });
  if (!hasRecentAuthentication(context.session.session)) return recentAuthError();
  const body = await request.json().catch(() => null) as { confirmation?: unknown; acknowledge?: unknown } | null;
  if (body?.confirmation !== context.workspace.organizationSlug || body.acknowledge !== true) {
    return NextResponse.json({ error: "Type the workspace slug and confirm the permanent deletion warning" }, { status: 400 });
  }

  const now = new Date();
  const schedule = workspaceDeletionSchedule(now);
  const result = await db.transaction(async (tx) => {
    const [deletion] = await tx.insert(schema.workspaceDeletionRequests).values({
      organizationId: context.workspace.organizationId,
      requestedByUserId: context.workspace.userId,
      status: "cooling_off",
      coolingOffEndsAt: schedule.coolingOffEndsAt,
      purgeAfter: schedule.purgeAfter,
    }).onConflictDoUpdate({
      target: schema.workspaceDeletionRequests.organizationId,
      set: {
        requestedByUserId: context.workspace.userId,
        status: "cooling_off",
        coolingOffEndsAt: schedule.coolingOffEndsAt,
        purgeAfter: schedule.purgeAfter,
        disabledAt: null,
        purgeStartedAt: null,
        completedAt: null,
        cancelledAt: null,
        failedAt: null,
        errorMessage: null,
        updatedAt: now,
      },
      setWhere: inArray(schema.workspaceDeletionRequests.status, ["completed", "cancelled", "failed"]),
    }).returning();

    if (!deletion) {
      const existing = (await tx.select().from(schema.workspaceDeletionRequests)
        .where(eq(schema.workspaceDeletionRequests.organizationId, context.workspace.organizationId)).limit(1))[0];
      return { deletion: null, existing };
    }

    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      action: "workspace.delete.requested",
      targetType: "organization",
      targetId: context.workspace.organizationId,
      metadata: { coolingOffEndsAt: schedule.coolingOffEndsAt.toISOString(), purgeAfter: schedule.purgeAfter.toISOString() },
    });
    await tx.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      actorAuthUserId: context.session.user.id,
      action: "workspace.delete.requested",
      targetType: "organization",
      targetId: context.workspace.organizationId,
      metadata: { deletionRequestId: deletion.id, coolingOffEndsAt: schedule.coolingOffEndsAt.toISOString(), purgeAfter: schedule.purgeAfter.toISOString() },
    });
    return { deletion, existing: null };
  });

  if (!result.deletion) {
    return NextResponse.json({ error: "Workspace deletion is already scheduled", request: result.existing }, { status: 409 });
  }

  return NextResponse.json({ request: result.deletion }, { status: 202 });
}

export async function DELETE() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.deleteWorkspace")) return NextResponse.json({ error: "Workspace deletion is owner-only" }, { status: 403 });
  if (!hasRecentAuthentication(context.session.session)) return recentAuthError();
  const request = (await db.select().from(schema.workspaceDeletionRequests).where(and(
    eq(schema.workspaceDeletionRequests.organizationId, context.workspace.organizationId),
    eq(schema.workspaceDeletionRequests.status, "cooling_off"),
  )).limit(1))[0];
  if (!request) return NextResponse.json({ error: "No cancellable deletion request was found" }, { status: 404 });
  const now = new Date();
  await db.update(schema.workspaceDeletionRequests).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(schema.workspaceDeletionRequests.id, request.id));
  await db.insert(schema.dataLifecycleAuditLogs).values({
    organizationId: context.workspace.organizationId,
    actorUserId: context.workspace.userId,
    actorAuthUserId: context.session.user.id,
    action: "workspace.delete.cancelled",
    targetType: "organization",
    targetId: context.workspace.organizationId,
    metadata: { deletionRequestId: request.id },
  });
  return NextResponse.json({ status: "cancelled" });
}
