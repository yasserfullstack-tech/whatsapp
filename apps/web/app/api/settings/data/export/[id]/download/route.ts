import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { createPresignedDownload, createR2Client, isObjectKeyWithinPrefix } from "@wa/storage";
import { getAuthContext } from "@/lib/auth-context";
import { db, getR2ServerConfig } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "data.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const job = (await db.select().from(schema.dataExportJobs).where(and(
    eq(schema.dataExportJobs.id, id),
    eq(schema.dataExportJobs.organizationId, context.workspace.organizationId),
  )).limit(1))[0];
  if (!job) return NextResponse.json({ error: "Export not found" }, { status: 404 });
  if (job.status !== "completed") return NextResponse.json({ error: "Export is not ready" }, { status: 409 });
  if (!job.expiresAt || job.expiresAt.getTime() <= Date.now()) return NextResponse.json({ error: "Export has expired" }, { status: 410 });

  const expectedPrefix = `${context.workspace.organizationId}/data-exports/${job.id}/`;
  if (!isObjectKeyWithinPrefix(job.objectKey, expectedPrefix)) {
    return NextResponse.json({ error: "Export storage key is invalid" }, { status: 409 });
  }

  const config = getR2ServerConfig();
  const url = await createPresignedDownload({
    client: createR2Client(config),
    bucket: config.bucket,
    key: job.objectKey,
    fileName: job.fileName,
    expiresInSeconds: 300,
  });
  await db.insert(schema.dataLifecycleAuditLogs).values({
    organizationId: context.workspace.organizationId,
    actorUserId: context.workspace.userId,
    actorAuthUserId: context.session.user.id,
    action: "export.download_url.created",
    targetType: "data_export_job",
    targetId: job.id,
    metadata: { expiresInSeconds: 300 },
  });
  return NextResponse.json({ url, expiresInSeconds: 300 }, { headers: { "Cache-Control": "no-store" } });
}
