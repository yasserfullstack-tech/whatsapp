import Link from "next/link";
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform-admin";
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

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  return <div className="admin-shell">
    <aside className="admin-nav">
      <div className="admin-brand"><strong>Platform Admin</strong><span>SaaS owner control plane</span></div>
      <nav className="admin-links">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
      <div className="admin-actor"><strong>{admin.name}</strong><br />{admin.email}<br />grant: {admin.source}</div>
    </aside>
    <main className="admin-main">{children}</main>
  </div>;
}
