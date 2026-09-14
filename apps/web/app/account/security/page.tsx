import { AppSidebar } from "@/components/app-sidebar";
import { AccountSecurityPanel } from "@/components/account-security-panel";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const [{ session, workspace }, { locale }] = await Promise.all([requireAuthContext(), getI18n()]);
  const copy = productionUiMessages[locale].accountSecurityPage;
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <main className="shell">
      <AppSidebar active="settings" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <p className="subtitle">{copy.subtitle}</p>
          </div>
        </header>
        <AccountSecurityPanel currentEmail={session.user.email} />
      </section>
    </main>
  );
}
