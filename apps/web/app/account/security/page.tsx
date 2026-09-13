import { AppSidebar } from "@/components/app-sidebar";
import { AccountSecurityPanel } from "@/components/account-security-panel";
import { requireAuthContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const { session, workspace } = await requireAuthContext();
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <main className="shell">
      <AppSidebar active="settings" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Account</p>
            <h1>Security</h1>
            <p className="subtitle">Protect your account, review active sessions, and manage recovery settings.</p>
          </div>
        </header>
        <AccountSecurityPanel currentEmail={session.user.email} />
      </section>
    </main>
  );
}
