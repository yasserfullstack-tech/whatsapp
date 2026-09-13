import { SettingsNav } from "@/components/settings-nav";
import { requireAuthContext } from "@/lib/auth-context";
import { can } from "@/lib/workspace-access";

export default async function BillingSettingsPage() {
  const { workspace } = await requireAuthContext();
  const canManage = can(workspace.role, "billing.manage");

  return (
    <>
      <header className="topbar settingsHeader">
        <div>
          <p className="eyebrow">Workspace settings</p>
          <h1>Billing</h1>
          <p className="subtitle">Plan, usage, and billing administration for this workspace.</p>
        </div>
      </header>
      <SettingsNav active="/settings/billing" />
      <section className="panel settingsPanel">
        <div className="panelHeader">
          <div>
            <h2>Billing foundation</h2>
            <p className="subtitle">Billing is workspace-scoped and ownership remains separate from platform administration.</p>
          </div>
          <span className="roleBadge">{canManage ? "Manage" : "Read only"}</span>
        </div>
        <div className="settingsCallout">
          <strong>No billing provider connected yet</strong>
          <p>The route and permission boundary are ready for plan, invoice, and payment-provider integration.</p>
        </div>
      </section>
    </>
  );
}
