import { count, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function DataSettingsPage() {
  const { workspace } = await requireAuthContext();
  const [contactRows, campaignRows, templateRows] = await Promise.all([
    db.select({ total: count() }).from(schema.contacts).where(eq(schema.contacts.organizationId, workspace.organizationId)),
    db.select({ total: count() }).from(schema.campaigns).where(eq(schema.campaigns.organizationId, workspace.organizationId)),
    db.select({ total: count() }).from(schema.templates).where(eq(schema.templates.organizationId, workspace.organizationId)),
  ]);
  const canExport = can(workspace.role, "data.export");

  return (
    <>
      <header className="topbar settingsHeader">
        <div>
          <p className="eyebrow">Workspace settings</p>
          <h1>Data</h1>
          <p className="subtitle">Workspace data inventory and export boundary.</p>
        </div>
        {canExport ? <a className="primary" href="/api/settings/data/export" download>Export workspace data</a> : null}
      </header>
      <SettingsNav active="/settings/data" />
      <section className="statsGrid settingsStats" aria-label="Workspace data inventory">
        <article className="statCard"><span>Contacts</span><strong>{contactRows[0]?.total ?? 0}</strong><p>Contacts owned by this organization.</p></article>
        <article className="statCard"><span>Campaigns</span><strong>{campaignRows[0]?.total ?? 0}</strong><p>Campaign records for this organization.</p></article>
        <article className="statCard"><span>Templates</span><strong>{templateRows[0]?.total ?? 0}</strong><p>Template records scoped to this organization.</p></article>
      </section>
      <section className="panel settingsPanel">
        <div className="settingsCallout">
          <strong>{canExport ? "Your role is allowed to export workspace data" : "Read-only data access"}</strong>
          <p>{canExport
            ? "The JSON export is generated only from this workspace and excludes credential secrets, encryption material, raw webhook payloads, presigned credentials, and high-volume delivery telemetry."
            : "Your role can inspect this inventory but cannot download workspace data."}</p>
        </div>
      </section>
    </>
  );
}
