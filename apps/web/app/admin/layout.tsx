import Link from "next/link";
import type { ReactNode } from "react";
import {
  readPlatformAdminStepUp,
  requirePlatformAdmin,
} from "@/lib/platform-admin";
import "./admin.css";

export const dynamic = "force-dynamic";

const links = [
  ["Overview", "/admin"],
  ["Organizations", "/admin/organizations"],
  ["Users", "/admin/users"],
  ["Platform access", "/admin/access"],
  ["Billing", "/admin/billing"],
  ["Campaigns", "/admin/campaigns"],
  ["Connections", "/admin/connections"],
  ["Imports", "/admin/imports"],
  ["Webhooks", "/admin/webhooks"],
  ["System", "/admin/system"],
  ["Audit", "/admin/audit"],
] as const;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requirePlatformAdmin();
  // Every mutation under /admin goes through requirePlatformAdminStepUp(), which
  // throws when either precondition is missing. That throw reached the user as an
  // unexplained HTTP 500, so state the requirement here instead.
  const stepUp = await readPlatformAdminStepUp(admin);
  const blocked = !stepUp.twoFactorEnabled || !stepUp.recentAuthentication;
  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <div className="admin-brand">
          <strong>Platform Admin</strong>
          <span>SaaS owner control plane</span>
        </div>
        <nav className="admin-links">
          {links.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="admin-actor">
          <strong>{admin.name}</strong>
          <br />
          {admin.email}
          <br />
          grant: {admin.source}
        </div>
      </aside>
      <main className="admin-main">
        {blocked ? (
          <div className="admin-stepup" role="status">
            {stepUp.twoFactorEnabled
              ? "Sign-in is no longer recent. Sign out and sign back in before changing platform data."
              : "Platform changes require two-factor authentication on your account."}{" "}
            <Link href="/account/security">
              {stepUp.twoFactorEnabled ? "Account security" : "Enable MFA"}
            </Link>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
