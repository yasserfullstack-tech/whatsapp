import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { createExportIdentity, isExportKind } from "@/lib/data-lifecycle";
import { getAuthContext } from "@/lib/auth-context";
import { dataExportQueue, db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function GET() {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const jobs = await db.select({
    id: schema.dataExportJobs.id,
    kind: schema.dataExportJobs.kind,
    status: schema.dataExportJobs.status,
    fileName: schema.dataExportJobs.fileName,
    rowCount: schema.dataExportJobs.rowCount,
    expiresAt: schema.dataExportJobs.expiresAt,
    completedAt: schema.dataExportJobs.completedAt,
    errorMessage: schema.dataExportJobs.errorMessage,
    createdAt: schema.dataExportJobs.createdAt,
  }).from(schema.dataExportJobs)
    .where(eq(schema.dataExportJobs.organizationId, context.workspace.organizationId))
    .orderBy(desc(schema.dataExportJobs.createdAt)).limit(25);

  return NextResponse.json({
    organization: { id: context.workspace.organizationId },
    jobs,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null) as { kind?: unknown } | null;
  if (!isExportKind(body?.kind)) return NextResponse.json({ error: "Invalid export kind" }, { status: 400 });

  const identity = createExportIdentity(context.workspace.organizationId, context.workspace.organizationSlug, body.kind);
  const createdAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.dataExportJobs).values({
      id: identity.id,
      organizationId: context.workspace.organizationId,
      requestedByUserId: context.workspace.userId,
      kind: body.kind,
      objectKey: identity.objectKey,
      fileName: identity.fileName,
      status: "queued",
    });
    await tx.insert(schema.workspaceAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      action: "data.export.requested",
      targetType: "data_export_job",
      targetId: identity.id,
      metadata: { kind: body.kind },
    });
    await tx.insert(schema.dataLifecycleAuditLogs).values({
      organizationId: context.workspace.organizationId,
      actorUserId: context.workspace.userId,
      actorAuthUserId: context.session.user.id,
      action: "export.requested",
      targetType: "data_export_job",
      targetId: identity.id,
      metadata: { kind: body.kind, createdAt: createdAt.toISOString() },
    });
  });

  await dataExportQueue.add("export", {
    organizationId: context.workspace.organizationId,
    exportJobId: identity.id,
  }, { jobId: `data-export-${identity.id}` }).catch(() => undefined);

  return NextResponse.json({ id: identity.id, kind: body.kind, status: "queued", createdAt: createdAt.toISOString() }, { status: 202 });
}
