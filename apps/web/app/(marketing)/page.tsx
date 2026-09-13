import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing/site";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getI18n();
  const isAr = locale === "ar";
  const title = isAr ? "حملات واتساب | تشغيل حملات واتساب عبر Meta" : "WhatsApp Campaigns | Campaign operations through Meta";
  const description = isAr
    ? "منصة لإدارة جهات الاتصال والجماهير والقوالب والحملات والتحليلات والموافقة مع تكامل مباشر مع Meta."
    : "Manage contacts, audiences, templates, campaigns, analytics, consent, and suppression with direct Meta integration.";

  return {
    title,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      type: "website",
      url: "/",
      siteName: isAr ? "حملات واتساب" : "WhatsApp Campaigns",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MarketingPage() {
  const { locale } = await getI18n();
  return <MarketingHome locale={locale} />;
}
