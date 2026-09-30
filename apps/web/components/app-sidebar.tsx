"use client";

import Link from "next/link";
import { NotificationBell } from "@/components/notification-bell";
import { SignOutButton } from "@/components/sign-out-button";
import { useI18n } from "@/components/i18n-provider";

type ActiveNav =
  | "overview"
  | "onboarding"
  | "inbox"
  | "contacts"
  | "audiences"
  | "templates"
  | "campaigns"
  | "reports"
  | "notifications"
  | "settings";

// Eleven identical dots made the sidebar unscannable. Hand-drawn on a 24 grid so
// the app keeps its zero-dependency supply chain; stroke inherits currentColor
// so the active and hover states come from .navItem alone.
const ICONS: Record<string, string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  onboarding:
    "M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2",
  inbox: "M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z",
  contacts:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  audiences:
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  templates:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  campaigns: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  reports: "M18 20V10M12 20V4M6 20v-6",
  settings:
    "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  notifications:
    "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="navIcon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] ?? ICONS.overview} />
    </svg>
  );
}

export function AppSidebar({
  active,
  workspaceName,
  email,
  initials,
}: {
  active: ActiveNav;
  workspaceName: string;
  email: string;
  initials: string;
}) {
  const { messages, locale } = useI18n();
  const nav = [
    {
      key: "overview" as const,
      label: messages.nav.overview,
      href: "/dashboard",
    },
    {
      key: "onboarding" as const,
      label: locale === "ar" ? "الإعداد" : "Setup",
      href: "/onboarding",
    },
    {
      key: "inbox" as const,
      label: locale === "ar" ? "صندوق الوارد" : "Inbox",
      href: "/inbox",
    },
    {
      key: "contacts" as const,
      label: messages.nav.contacts,
      href: "/contacts",
    },
    {
      key: "audiences" as const,
      label: messages.nav.audiences,
      href: "/audiences",
    },
    {
      key: "templates" as const,
      label: messages.nav.templates,
      href: "/templates",
    },
    {
      key: "campaigns" as const,
      label: messages.nav.campaigns,
      href: "/campaigns",
    },
    { key: "reports" as const, label: messages.nav.reports, href: "/reports" },
    {
      key: "settings" as const,
      label: messages.nav.settings,
      href: "/settings",
    },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark">W</div>
        <div>
          <strong>{messages.common.whatsapp}</strong>
          <span>{messages.common.campaigns}</span>
        </div>
      </div>
      <nav className="nav" aria-label={messages.nav.aria}>
        {nav.map((item) => (
          <Link
            className={item.key === active ? "navItem active" : "navItem"}
            href={item.href}
            key={item.key}
          >
            <NavIcon name={item.key} />
            {item.label}
          </Link>
        ))}
      </nav>
      <NotificationBell active={active === "notifications"} />
      <div className="workspace">
        <div className="workspaceAvatar">{initials || "W"}</div>
        <div className="workspaceMeta">
          <strong>{workspaceName}</strong>
          <span>{email}</span>
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
