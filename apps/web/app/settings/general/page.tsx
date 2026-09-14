import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { workspaceSettingsMessages } from "@/lib/i18n/workspace-settings";
import { switchWorkspaceAction, updateWorkspaceGeneralAction } from "@/lib/workspace-actions";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function GeneralSettingsPage() {
  const [{ workspace }, i18n] = await Promise.all([requireAuthContext(), getI18n()]);
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
  const m = workspaceSettingsMessages[i18n.locale];

  return (
    <>
      <header className="topbar settingsHeader">
        <div>
          <p className="eyebrow">{m.common.eyebrow}</p>
          <h1>{m.general.title}</h1>
          <p className="subtitle">{m.general.subtitle}</p>
        </div>
      </header>
      <SettingsNav active="/settings/general" />

      {memberships.length > 1 ? (
        <section className="panel settingsPanel">
          <div className="panelHeader">
            <div><h2>{m.general.activeWorkspace}</h2><p className="subtitle">{m.general.activeWorkspaceHelp}</p></div>
          </div>
          <form className="settingsFields" action={switchWorkspaceAction}>
            <label>
              <span>{m.general.workspace}</span>
              <select name="organizationId" defaultValue={workspace.organizationId}>
                {memberships.map((membership) => (
                  <option key={membership.organizationId} value={membership.organizationId}>
                    {membership.organizationName} · {m.common.roles[membership.role]}
                  </option>
                ))}
              </select>
            </label>
            <div><button className="primary" type="submit">{m.general.switchWorkspace}</button></div>
          </form>
        </section>
      ) : null}

      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div><h2>{m.general.organizationProfile}</h2><p className="subtitle">{m.general.organizationProfileHelp}</p></div>
          <span className="status connected">{m.common.roles[workspace.role]}</span>
        </div>
        <form className="settingsFields" action={updateWorkspaceGeneralAction}>
          <label><span>{m.general.organizationName}</span><input name="organizationName" defaultValue={workspace.organizationName} disabled={!editable} required minLength={2} maxLength={120} /></label>
          <label><span>{m.general.timezone}</span><input name="timezone" defaultValue={preferences?.timezone ?? "UTC"} disabled={!editable} required placeholder="Asia/Baghdad" /></label>
          <label><span>{m.general.defaultCountry}</span><input name="defaultCountry" defaultValue={preferences?.defaultCountry ?? ""} disabled={!editable} maxLength={2} placeholder="IQ" /></label>
          <label>
            <span>{m.general.preferredLanguage}</span>
            <select name="preferredLanguage" defaultValue={preferences?.preferredLanguage ?? "en"} disabled={!editable}>
              <option value="en">{m.general.english}</option>
              <option value="ar">{m.general.arabic}</option>
            </select>
          </label>
          {editable ? <div><button className="primary" type="submit">{m.general.saveChanges}</button></div> : null}
        </form>
        {!editable ? <p className="settingsHint">{m.common.readOnly}</p> : null}
      </section>
    </>
  );
}
