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
        <button className="primary" disabled title="Export job is the next implementation slice" type="button">Export workspace data</button>
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
          <p>The route is ready for an asynchronous export job and signed-download workflow without exposing another tenant's objects.</p>
        </div>
      </section>
    </>
  );
}
