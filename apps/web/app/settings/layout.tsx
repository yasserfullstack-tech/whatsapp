import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { requireAuthContext } from "@/lib/auth-context";
import "./settings.css";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { session, workspace } = await requireAuthContext();
  const initials = workspace.organizationName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <main className="shell">
      <AppSidebar active="settings" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content settingsContent">{children}</section>
    </main>
  );
}
