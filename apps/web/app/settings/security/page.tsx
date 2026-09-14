import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { formatMessage } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { workspaceSettingsMessages } from "@/lib/i18n/workspace-settings";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function SecuritySettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
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
  const m = workspaceSettingsMessages[i18n.locale];
  const dateTime = new Intl.DateTimeFormat(i18n.localeTag, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <header className="topbar settingsHeader">
        <div><p className="eyebrow">{m.common.eyebrow}</p><h1>{m.security.title}</h1><p className="subtitle">{m.security.subtitle}</p></div>
      </header>
      <SettingsNav active="/settings/security" />
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>{m.security.accessPolicy}</h2><p className="subtitle">{m.security.accessPolicyHelp}</p></div></div>
        <div className="settingsCallout"><strong>{formatMessage(m.security.yourRole, { role: m.common.roles[workspace.role] })}</strong><p>{m.security.ownershipHelp}</p></div>
      </section>
      <section className="panel settingsPanel">
        <div className="panelHeader"><div><h2>{m.security.auditLog}</h2><p className="subtitle">{m.security.auditHelp}</p></div></div>
        {!canReadAudit ? <p className="settingsHint">{m.security.auditRestricted}</p> : auditRows.length ? <div className="settingsList">{auditRows.map((row) => (
          <div className="settingsListRow" key={row.id}>
            <div><strong>{row.action}</strong><p>{row.actorName || row.actorEmail || m.security.system}{row.targetType ? ` · ${row.targetType}` : ""}</p></div>
            <time dateTime={row.createdAt.toISOString()}>{dateTime.format(row.createdAt)}</time>
          </div>
        ))}</div> : <p className="settingsHint">{m.security.noAudit}</p>}
      </section>
    </>
  );
}