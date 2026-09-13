import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export default async function GeneralSettingsPage() {
  const { workspace } = await requireAuthContext();
  const preferences = (
    await db
      .select()
      .from(schema.workspacePreferences)
      .where(eq(schema.workspacePreferences.organizationId, workspace.organizationId))
      .limit(1)
  )[0];
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
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div><h2>Organization profile</h2><p className="subtitle">These values are shared by everyone in the workspace.</p></div>
          <span className="status connected">{workspace.role}</span>
        </div>
        <div className="settingsFields">
          <label><span>Organization name</span><input defaultValue={workspace.organizationName} disabled /></label>
          <label><span>Timezone</span><input defaultValue={preferences?.timezone ?? "UTC"} disabled /></label>
          <label><span>Default country</span><input defaultValue={preferences?.defaultCountry ?? "Not set"} disabled /></label>
          <label><span>Preferred language</span><input defaultValue={preferences?.preferredLanguage === "ar" ? "Arabic" : "English"} disabled /></label>
        </div>
        <p className="settingsHint">{editable ? "Editing will be enabled through the tenant-scoped settings mutation API." : "Your role has read-only access to these settings."}</p>
      </section>
    </>
  );
}
