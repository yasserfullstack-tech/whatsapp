"use client";

import { useI18n } from "@/components/i18n-provider";

export function LanguageSwitcher() {
  const { locale, messages } = useI18n();

  function setLocale(next: "en" | "ar") {
    if (next === locale) return;
    document.cookie = `locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    window.location.reload();
  }

  return (
    <div className="languageSwitcher" role="group" aria-label={messages.common.language}>
      <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} type="button" aria-pressed={locale === "en"}>EN</button>
      <button className={locale === "ar" ? "active" : ""} onClick={() => setLocale("ar")} type="button" aria-pressed={locale === "ar"}>العربية</button>
    </div>
  );
}
