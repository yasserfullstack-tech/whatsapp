"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { settingsNavMessages } from "@/lib/i18n/settings";

export function SettingsNav({ active }: { active: string }) {
  const { locale } = useI18n();
  const messages = settingsNavMessages[locale];
  const settingsLinks = [
    [messages.general, "/settings/general"],
    [messages.team, "/settings/team"],
    [messages.whatsapp, "/settings/whatsapp"],
    [messages.security, "/settings/security"],
    [messages.notifications, "/settings/notifications"],
    [messages.billing, "/settings/billing"],
    [messages.data, "/settings/data"],
  ] as const;

  return (
    <nav aria-label={messages.aria} className="settingsNav">
      {settingsLinks.map(([label, href]) => (
        <Link className={active === href ? "settingsNavItem active" : "settingsNavItem"} href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
