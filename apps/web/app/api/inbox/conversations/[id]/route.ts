import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  assignedUserId: z.string().uuid().nullable().optional(),
  status: z.enum(["open", "closed"]).optional(),
  markRead: z.boolean().optional(),
}).refine(
  (value) => value.assignedUserId !== undefined || value.status !== undefined || value.markRead === true,
  { message: "At least one conversation change is required" },
);

export async function PATCH(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "inbox.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid conversation update", issues: parsed.error.issues }, { status: 400 });
  }

  const managementChange = parsed.data.assignedUserId !== undefined || parsed.data.status !== undefined;
  if (managementChange && !can(context.workspace.role, "inbox.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await routeContext.params;
  const organizationId = context.workspace.organizationId;
  const conversation = (
    await db
      .select({ id: schema.inboxConversations.id })
      .from(schema.inboxConversations)
      .where(and(
        eq(schema.inboxConversations.id, id),
        eq(schema.inboxConversations.organizationId, organizationId),
      ))
      .limit(1)
  )[0];
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  if (parsed.data.assignedUserId) {
    const member = (
      await db
        .select({ userId: schema.organizationMembers.userId })
        .from(schema.organizationMembers)
        .where(and(
          eq(schema.organizationMembers.organizationId, organizationId),
          eq(schema.organizationMembers.userId, parsed.data.assignedUserId),
        ))
        .limit(1)
    )[0];
    if (!member) return NextResponse.json({ error: "Assignee is not a workspace member" }, { status: 400 });
  }

  const now = new Date();
  const updates: Partial<typeof schema.inboxConversations.$inferInsert> = { updatedAt: now };
  if (parsed.data.assignedUserId !== undefined) updates.assignedUserId = parsed.data.assignedUserId;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    updates.closedAt = parsed.data.status === "closed" ? now : null;
  }
  if (parsed.data.markRead) updates.unreadCount = 0;

  const [updated] = await db
    .update(schema.inboxConversations)
    .set(updates)
    .where(and(
      eq(schema.inboxConversations.id, id),
      eq(schema.inboxConversations.organizationId, organizationId),
    ))
    .returning({
      id: schema.inboxConversations.id,
      assignedUserId: schema.inboxConversations.assignedUserId,
      status: schema.inboxConversations.status,
      unreadCount: schema.inboxConversations.unreadCount,
      closedAt: schema.inboxConversations.closedAt,
    });

  return NextResponse.json({ conversation: updated });
}
