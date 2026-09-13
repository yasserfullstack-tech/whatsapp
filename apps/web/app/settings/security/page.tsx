import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function SecuritySettingsPage() {
  const { workspace } = await requireAuthContext();
  const canReadAudit = can(workspace.role, "audit.read");
  const auditRows = canReadAudit
    ? await db
        .select({
          id: schema.workspaceAuditLogs.id,
          action: schema.workspaceAuditLogs.action,
          targetType: schema.workspaceAuditLogs.targetType,
          createdAt: schema.workspaceAuditLogs.createdAt,
          actorName: schema.users.displayName,
          actorEmail: schema.users.email,
        })
        .from(schema.workspaceAuditLogs)
        .leftJoin(schema.users, eq(schema.users.id, schema.workspaceAuditLogs.actorUserId))
        .where(eq(schema.workspaceAuditLogs.organizationId, workspace.organizationId))
        .orderBy(desc(schema.workspaceAuditLogs.createdAt))
        .limit(50)
    : [];

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">Workspace settings</p><h1>Security</h1><p className="subtitle">Workspace-level security controls and administrative activity.</p></div>
      </header>
      <SettingsNav active="/settings/security" />
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Access policy</h2><p className="subtitle">Permissions are resolved from Owner, Admin, Member, and Viewer roles through one matrix.</p></div></div>
        <div className="settingsCallout"><strong>Your role: {workspace.role}</strong><p>Ownership transfer remains owner-only. Administrative mutations are denied unless the role matrix explicitly allows them.</p></div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>Workspace audit log</h2><p className="subtitle">Recent administrative events for this organization.</p></div></div>
        {!canReadAudit ? <p className="settingsHint">Audit history is available to workspace owners and admins.</p> : auditRows.length ? <div className="settingsList">{auditRows.map((row) => (
          <div className="settingsListRow" key={row.id}>
            <div><strong>{row.action}</strong><p>{row.actorName || row.actorEmail || "System"}{row.targetType ? ` · ${row.targetType}` : ""}</p></div>
            <time dateTime={row.createdAt.toISOString()}>{row.createdAt.toLocaleString()}</time>
          </div>
        ))}</div> : <p className="settingsHint">No workspace administration events have been recorded yet.</p>}
      </section>
    </>
  );
}
