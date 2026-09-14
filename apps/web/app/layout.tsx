import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getI18n } from "@/lib/i18n/server";
import { getPublicAppUrl } from "@/lib/public-app-url";
import "./globals.css";
import "./responsive.css";

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getI18n();
  return {
    metadataBase: getPublicAppUrl(),
    title: messages.meta.title,
    description: messages.meta.description,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, dir, messages } = await getI18n();
  return (
    <html lang={locale} dir={dir}>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          <LanguageSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
