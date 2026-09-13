import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { switchWorkspaceAction, updateWorkspaceGeneralAction } from "@/lib/workspace-actions";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function GeneralSettingsPage() {
  const { workspace } = await requireAuthContext();
  const [preferences, memberships] = await Promise.all([
    db
      .select()
      .from(schema.workspacePreferences)
      .where(eq(schema.workspacePreferences.organizationId, workspace.organizationId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        organizationId: schema.organizations.id,
        organizationName: schema.organizations.name,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.organizationId))
      .where(eq(schema.organizationMembers.userId, workspace.userId)),
  ]);
  const editable = can(workspace.role, "workspace.update");

  return (
    <>
      <header className="topbar settingsHeader">
        <div>
          <p className="eyebrow">Workspace settings</p>
          <h1>General</h1>
          <p className="subtitle">Manage the identity and regional defaults for this workspace.</p>
        </div>
      </header>
      <SettingsNav active="/settings/general" />

      {memberships.length > 1 ? (
        <section className="panel settingsPanel">
          <div className="panelHeader">
            <div><h2>Active workspace</h2><p className="subtitle">Switch only to workspaces where your account is already a member.</p></div>
          </div>
          <form className="settingsFields" action={switchWorkspaceAction}>
            <label>
              <span>Workspace</span>
              <select name="organizationId" defaultValue={workspace.organizationId}>
                {memberships.map((membership) => (
                  <option key={membership.organizationId} value={membership.organizationId}>
                    {membership.organizationName} · {membership.role}
                  </option>
                ))}
              </select>
            </label>
            <div><button className="primary" type="submit">Switch workspace</button></div>
          </form>
        </section>
      ) : null}

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div><h2>Organization profile</h2><p className="subtitle">These values are shared by everyone in the workspace.</p></div>
          <span className="status connected">{workspace.role}</span>
        </div>
        <form className="settingsFields" action={updateWorkspaceGeneralAction}>
          <label><span>Organization name</span><input name="organizationName" defaultValue={workspace.organizationName} disabled={!editable} required minLength={2} maxLength={120} /></label>
          <label><span>Timezone</span><input name="timezone" defaultValue={preferences?.timezone ?? "UTC"} disabled={!editable} required placeholder="Asia/Baghdad" /></label>
          <label><span>Default country</span><input name="defaultCountry" defaultValue={preferences?.defaultCountry ?? ""} disabled={!editable} maxLength={2} placeholder="IQ" /></label>
          <label>
            <span>Preferred language</span>
            <select name="preferredLanguage" defaultValue={preferences?.preferredLanguage ?? "en"} disabled={!editable}>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </label>
          {editable ? <div><button className="primary" type="submit">Save changes</button></div> : null}
        </form>
        {!editable ? <p className="settingsHint">Your role has read-only access to these settings.</p> : null}
      </section>
    </>
  );
}
