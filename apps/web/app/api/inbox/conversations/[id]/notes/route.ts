import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const requestSchema = z.object({ body: z.string().trim().min(1).max(4_000) });

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "inbox.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note", issues: parsed.error.issues }, { status: 400 });
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

  const [note] = await db
    .insert(schema.inboxNotes)
    .values({
      organizationId,
      conversationId: conversation.id,
      authorUserId: context.workspace.userId,
      body: parsed.data.body,
    })
    .returning({ id: schema.inboxNotes.id, createdAt: schema.inboxNotes.createdAt });

  return NextResponse.json({ note }, { status: 201 });
}
