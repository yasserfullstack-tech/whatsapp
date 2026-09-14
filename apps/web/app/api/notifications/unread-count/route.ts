import { NextResponse } from "next/server";
import { getUnreadNotificationCount } from "@wa/notifications";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const unread = await getUnreadNotificationCount(db, {
    organizationId: context.workspace.organizationId,
    userId: context.workspace.userId,
  });
  return NextResponse.json({ unread });
}
