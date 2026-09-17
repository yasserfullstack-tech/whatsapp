import { and, eq } from "drizzle-orm";
import { toNextJsHandler } from "better-auth/next-js";
import { schema } from "@wa/db";
import { auth, db } from "@/lib/server";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

const MAX_AUTH_BODY_BYTES = 64 * 1024;
const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

function securityAction(pathname: string): string | null {
  if (pathname.endsWith("/change-password")) return "security.account.password_changed";
  if (pathname.endsWith("/change-email")) return "security.account.email_change_requested";
  if (pathname.endsWith("/revoke-session")) return "security.account.session_revoked";
  if (pathname.endsWith("/revoke-other-sessions")) return "security.account.other_sessions_revoked";
  if (pathname.endsWith("/two-factor/enable")) return "security.account.mfa_enabled";
  if (pathname.endsWith("/two-factor/disable")) return "security.account.mfa_disabled";
  if (pathname.endsWith("/two-factor/generate-backup-codes")) return "security.account.backup_codes_regenerated";
  return null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return valueParts.join("=");
    }
  }
  return null;
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

async function auditSecurityMutation(input: {
  externalAuthId: string;
  action: string;
  cookieHeader: string | null;
}) {
  const appUser = (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.externalAuthId, input.externalAuthId))
      .limit(1)
  )[0];
  if (!appUser) return;

  const preferredOrganizationId = cookieValue(input.cookieHeader, WORKSPACE_COOKIE);
  const preferredMembership = isUuid(preferredOrganizationId) ? (
    await db
      .select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(and(
        eq(schema.organizationMembers.userId, appUser.id),
        eq(schema.organizationMembers.organizationId, preferredOrganizationId),
      ))
      .limit(1)
  )[0] : null;

  const membership = preferredMembership ?? (
    await db
      .select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, appUser.id))
      .limit(1)
  )[0];
  if (!membership) return;

  await db.insert(schema.workspaceAuditLogs).values({
    organizationId: membership.organizationId,
    actorUserId: appUser.id,
    action: input.action,
    targetType: "user",
    targetId: appUser.id,
    metadata: { source: "better_auth" },
  });
}

export async function POST(request: Request) {
  const action = securityAction(new URL(request.url).pathname);
  const session = action ? await auth.api.getSession({ headers: request.headers }) : null;
  let forwardedRequest = request;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_BODY_BYTES) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUTH_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Request body too large" }, { status: 413 });
      }
      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const headers = new Headers(request.headers);
    headers.set("content-length", String(total));

    forwardedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    });
  }

  const response = await handlers.POST(forwardedRequest);
  if (action && session && response.ok) {
    try {
      await auditSecurityMutation({
        externalAuthId: session.user.id,
        action,
        cookieHeader: request.headers.get("cookie"),
      });
    } catch (error) {
      console.error("Failed to persist security account audit event", { action, error });
    }
  }
  return response;
}
