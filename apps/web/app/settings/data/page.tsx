import { count, desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { DataLifecyclePanel } from "@/components/data-lifecycle-panel";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

const defaults = { rawWebhookDays: 30, importFileDays: 7, exportFileHours: 24, auditLogDays: 365, campaignRecipientDays: 365 };

export default async function DataSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
  const organizationId = workspace.organizationId;
  const [contactRows, campaignRows, templateRows, policyRow, deletionRow, jobs] = await Promise.all([
    db.select({ total: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.campaigns).where(eq(schema.campaigns.organizationId, organizationId)),
    db.select({ total: count() }).from(schema.templates).where(eq(schema.templates.organizationId, organizationId)),
    db.select().from(schema.dataRetentionPolicies).where(eq(schema.dataRetentionPolicies.organizationId, organizationId)).limit(1),
    db.select().from(schema.workspaceDeletionRequests).where(eq(schema.workspaceDeletionRequests.organizationId, organizationId)).limit(1),
    db.select({
      id: schema.dataExportJobs.id,
      kind: schema.dataExportJobs.kind,
      status: schema.dataExportJobs.status,
      fileName: schema.dataExportJobs.fileName,
      rowCount: schema.dataExportJobs.rowCount,
      expiresAt: schema.dataExportJobs.expiresAt,
      completedAt: schema.dataExportJobs.completedAt,
      errorMessage: schema.dataExportJobs.errorMessage,
      createdAt: schema.dataExportJobs.createdAt,
    }).from(schema.dataExportJobs).where(eq(schema.dataExportJobs.organizationId, organizationId)).orderBy(desc(schema.dataExportJobs.createdAt)).limit(25),
  ]);
  const ar = i18n.locale === "ar";
  const policy = policyRow[0] ?? defaults;
  const deletion = deletionRow[0] && deletionRow[0].status !== "cancelled" && deletionRow[0].status !== "completed" ? deletionRow[0] : null;

  return <>
    <header className="topbar settingsHeader">
      <div><p className="eyebrow">{ar ? "إعدادات مساحة العمل" : "Workspace settings"}</p><h1>{ar ? "البيانات" : "Data"}</h1><p className="subtitle">{ar ? "التصدير والاحتفاظ والحذف الآمن لبيانات مساحة العمل." : "Export, retention, and safe deletion controls for workspace data."}</p></div>
    </header>
    <SettingsNav active="/settings/data" />
    <section className="statsGrid settingsStats" aria-label={ar ? "مخزون البيانات" : "Workspace data inventory"}>
      <article className="statCard"><span>{ar ? "جهات الاتصال" : "Contacts"}</span><strong>{contactRows[0]?.total ?? 0}</strong><p>{ar ? "جهات الاتصال التابعة لهذه المساحة." : "Contacts owned by this organization."}</p></article>
      <article className="statCard"><span>{ar ? "الحملات" : "Campaigns"}</span><strong>{campaignRows[0]?.total ?? 0}</strong><p>{ar ? "سجلات الحملات التابعة لهذه المساحة." : "Campaign records for this organization."}</p></article>
      <article className="statCard"><span>{ar ? "القوالب" : "Templates"}</span><strong>{templateRows[0]?.total ?? 0}</strong><p>{ar ? "القوالب التابعة لهذه المساحة." : "Templates scoped to this organization."}</p></article>
    </section>
    <DataLifecyclePanel
      locale={i18n.locale}
      workspaceSlug={workspace.organizationSlug}
      canExport={can(workspace.role, "data.export")}
      canManageRetention={can(workspace.role, "data.retention")}
      canDeleteWorkspace={can(workspace.role, "data.deleteWorkspace")}
      initialRetention={{
        rawWebhookDays: policy.rawWebhookDays,
        importFileDays: policy.importFileDays,
        exportFileHours: policy.exportFileHours,
        auditLogDays: policy.auditLogDays,
        campaignRecipientDays: policy.campaignRecipientDays,
      }}
      initialDeletion={deletion ? {
        id: deletion.id,
        status: deletion.status,
        coolingOffEndsAt: deletion.coolingOffEndsAt.toISOString(),
        purgeAfter: deletion.purgeAfter.toISOString(),
        errorMessage: deletion.errorMessage,
      } : null}
      initialJobs={jobs.map((job) => ({
        ...job,
        expiresAt: job.expiresAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
      }))}
    />
  </>;
}
