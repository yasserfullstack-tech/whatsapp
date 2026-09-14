import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { hasRecentAuthentication } from "@/lib/recent-auth";
import { db } from "@/lib/server";

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRecentAuthentication(context.session.session)) {
    return NextResponse.json({ error: "Recent authentication required. Sign out and sign back in before retrying." }, { status: 428 });
  }
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== "DELETE ACCOUNT") return NextResponse.json({ error: "Type DELETE ACCOUNT to confirm" }, { status: 400 });

  const ownerships = await db.select({ organizationId: schema.organizationMembers.organizationId, role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, context.workspace.userId));
  if (ownerships.some((row) => row.role === "owner")) {
    return NextResponse.json({
      error: "Transfer ownership or delete every workspace you own before deleting your account",
      ownedWorkspaceCount: ownerships.filter((row) => row.role === "owner").length,
    }, { status: 409 });
  }

  const auditOrganizationId = ownerships[0]?.organizationId ?? context.workspace.organizationId;
  const deleted = await db.transaction(async (tx) => {
    const [removedUser] = await tx.delete(schema.users)
      .where(eq(schema.users.id, context.workspace.userId))
      .returning({ id: schema.users.id });
    if (!removedUser) return false;

    await tx.delete(schema.authUser).where(eq(schema.authUser.id, context.session.user.id));
    await tx.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: auditOrganizationId,
      actorUserId: context.workspace.userId,
      actorAuthUserId: context.session.user.id,
      action: "account.delete.completed",
      targetType: "user",
      targetId: context.workspace.userId,
      metadata: { membershipsRemoved: ownerships.length },
    });
    return true;
  });

  if (!deleted) {
    return NextResponse.json({ error: "Account deletion is already in progress or completed" }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
