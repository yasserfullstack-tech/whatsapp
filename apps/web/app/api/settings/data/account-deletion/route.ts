import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { hasRecentAuthentication } from "@/lib/recent-auth";
import { auth, db } from "@/lib/server";

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRecentAuthentication(context.session.session)) {
    return NextResponse.json({ error: "Recent authentication required. Sign out and sign back in before retrying." }, { status: 428 });
  }
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== "DELETE ACCOUNT") return NextResponse.json({ error: "Type DELETE ACCOUNT to confirm" }, { status: 400 });

  const result = await db.transaction(async (tx) => {
    let memberships = await tx.select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    }).from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, context.workspace.userId));

    const organizationIds = [...new Set(memberships.map((row) => row.organizationId))].sort();
    for (const organizationId of organizationIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`);
    }

    memberships = await tx.select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    }).from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, context.workspace.userId));

    const ownedWorkspaceCount = memberships.filter((row) => row.role === "owner").length;
    if (ownedWorkspaceCount > 0) {
      return { status: "owns_workspaces" as const, ownedWorkspaceCount };
    }

    const [lockedAuthUser] = await tx.select({ id: schema.authUser.id })
      .from(schema.authUser)
      .where(eq(schema.authUser.id, context.session.user.id))
      .for("update");
    if (!lockedAuthUser) return { status: "already_deleted" as const };

    await auth.api.revokeSessions({ headers: request.headers });

    const [removedUser] = await tx.delete(schema.users)
      .where(eq(schema.users.id, context.workspace.userId))
      .returning({ id: schema.users.id });
    if (!removedUser) return { status: "already_deleted" as const };

    await tx.delete(schema.authUser).where(eq(schema.authUser.id, context.session.user.id));
    await tx.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: memberships[0]?.organizationId ?? context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      actorAuthUserId: context.session.user.id,
      action: "account.delete.completed",
      targetType: "user",
      targetId: context.workspace.userId,
      metadata: { membershipsRemoved: memberships.length },
    });
    return { status: "deleted" as const };
  });

  if (result.status === "owns_workspaces") {
    return NextResponse.json({
      error: "Transfer ownership or delete every workspace you own before deleting your account",
      ownedWorkspaceCount: result.ownedWorkspaceCount,
    }, { status: 409 });
  }
  if (result.status === "already_deleted") {
    return NextResponse.json({ error: "Account deletion is already in progress or completed" }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
