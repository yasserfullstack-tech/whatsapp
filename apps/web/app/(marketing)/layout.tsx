import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/site";
import { getI18n } from "@/lib/i18n/server";
import "./marketing.css";

export default async function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = await getI18n();
  return <MarketingShell locale={locale}>{children}</MarketingShell>;
}
