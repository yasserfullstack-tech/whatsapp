import Link from "next/link";

const settingsLinks = [
  ["General", "/settings/general"],
  ["Team", "/settings/team"],
  ["WhatsApp", "/settings/whatsapp"],
  ["Security", "/settings/security"],
  ["Billing", "/settings/billing"],
  ["Data", "/settings/data"],
] as const;

export function SettingsNav({ active }: { active: string }) {
  return (
    <nav aria-label="Workspace settings" className="settingsNav">
      {settingsLinks.map(([label, href]) => (
        <Link className={active === href ? "settingsNavItem active" : "settingsNavItem"} href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
