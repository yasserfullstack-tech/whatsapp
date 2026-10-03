"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";

// Routes rendered inside the app shell. The sidebar mounts the switcher itself,
// so the root-layout instance stands down here instead of floating a second copy
// over the page. Auth and marketing keep the floating one, which has room to sit
// over a centred card.
const APP_ROUTES = [
  "/account",
  "/account-disabled",
  "/admin",
  "/audiences",
  "/campaigns",
  "/contacts",
  "/dashboard",
  "/inbox",
  "/invite",
  "/notifications",
  "/onboarding",
  "/reports",
  "/settings",
  "/templates",
  "/workspace-suspended",
];

export function LanguageSwitcher({ inline = false }: { inline?: boolean }) {
  const { locale, messages } = useI18n();
  const pathname = usePathname() ?? "";
  const inApp = APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  function setLocale(next: "en" | "ar") {
    if (next === locale) return;
    document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    window.location.reload();
  }

  if (inApp && !inline) return null;

  return (
    <div
      className={
        inline ? "languageSwitcher languageSwitcherInline" : "languageSwitcher"
      }
      role="group"
      aria-label={messages.common.language}
    >
      <button
        className={locale === "en" ? "active" : ""}
        onClick={() => setLocale("en")}
        type="button"
        aria-pressed={locale === "en"}
      >
        EN
      </button>
      <button
        className={locale === "ar" ? "active" : ""}
        onClick={() => setLocale("ar")}
        type="button"
        aria-pressed={locale === "ar"}
      >
        العربية
      </button>
    </div>
  );
}
