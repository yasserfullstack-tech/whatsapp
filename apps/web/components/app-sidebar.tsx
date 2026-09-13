"use client";

import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { useI18n } from "@/components/i18n-provider";

type ActiveNav = "overview" | "contacts" | "audiences" | "templates" | "campaigns" | "settings";

export function AppSidebar({ active, workspaceName, email, initials }: { active: ActiveNav; workspaceName: string; email: string; initials: string }) {
  const { messages } = useI18n();
  const nav = [
    { key: "overview" as const, label: messages.nav.overview, href: "/dashboard" },
    { key: "contacts" as const, label: messages.nav.contacts, href: "/contacts" },
    { key: "audiences" as const, label: messages.nav.audiences, href: "/audiences" },
    { key: "templates" as const, label: messages.nav.templates, href: "/templates" },
    { key: "campaigns" as const, label: messages.nav.campaigns, href: "/campaigns" },
    { key: "reports" as const, label: messages.nav.reports, href: "/campaigns" },
    { key: "settings" as const, label: messages.nav.settings, href: "/settings" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand"><div className="brandMark">W</div><div><strong>{messages.common.whatsapp}</strong><span>{messages.common.campaigns}</span></div></div>
      <nav className="nav" aria-label={messages.nav.aria}>
        {nav.map((item) => (
          <Link className={item.key === active ? "navItem active" : "navItem"} href={item.href} key={item.key}>
            <span className="navDot" aria-hidden="true" />{item.label}
          </Link>
        ))}
      </nav>
      <div className="workspace">
        <div className="workspaceAvatar">{initials || "W"}</div>
        <div className="workspaceMeta"><strong>{workspaceName}</strong><span>{email}</span></div>
        <SignOutButton />
      </div>
    </aside>
  );
}
