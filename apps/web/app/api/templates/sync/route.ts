import { NextResponse } from "next/server";
import { z } from "zod";
import { MetaApiError } from "@wa/meta";
import { getAuthContext } from "@/lib/auth-context";
import { getWabaAccessToken, listConnectedWabas } from "@/lib/meta-credentials";
import { getMetaServerConfig } from "@/lib/server";
import { syncWabaTemplates } from "@/lib/template-sync";
import { can } from "@/lib/workspace-access";

const requestSchema = z.object({ wabaId: z.string().min(1).max(128).optional() });

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "templates.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sync request" }, { status: 400 });

  const connected = await listConnectedWabas(context.workspace.organizationId);
  const targets = parsed.data.wabaId
    ? connected.filter((item) => item.wabaId === parsed.data.wabaId)
    : connected;

  if (!targets.length) {
    return NextResponse.json({ error: "No connected WhatsApp Business Account matched this request" }, { status: 400 });
  }

  const meta = getMetaServerConfig();

  try {
    let synced = 0;
    for (const target of targets) {
      const accessToken = await getWabaAccessToken(context.workspace.organizationId, target.wabaId);
      synced += await syncWabaTemplates({
        organizationId: context.workspace.organizationId,
        wabaId: target.wabaId,
        accessToken,
        graphApiVersion: meta.graphApiVersion,
      });
    }

    return NextResponse.json({ synced, wabas: targets.length });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("Template sync failed", { status: error.status, responseBody: error.responseBody });
      return NextResponse.json({ error: "Meta could not sync message templates" }, { status: 502 });
    }
    console.error("Template sync failed", error);
    return NextResponse.json({ error: "Could not sync message templates" }, { status: 500 });
  }
}
