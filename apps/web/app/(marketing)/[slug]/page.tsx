import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingContentPage } from "@/components/marketing/site";
import { getI18n } from "@/lib/i18n/server";
import { getMarketingCopy, isMarketingSlug, marketingSlugs } from "@/lib/marketing-content";

export function generateStaticParams() {
  return marketingSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isMarketingSlug(slug)) return {};

  const { locale } = await getI18n();
  const copy = getMarketingCopy(locale);
  const page = copy.pages[slug];
  const title = `${page.title} | ${copy.brand}`;

  return {
    title,
    description: page.description,
    alternates: { canonical: `/${slug}` },
    openGraph: {
      title,
      description: page.description,
      type: "website",
      url: `/${slug}`,
      siteName: copy.brand,
    },
    twitter: { card: "summary", title, description: page.description },
  };
}

export default async function PublicContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isMarketingSlug(slug)) notFound();

  const { locale } = await getI18n();
  return <MarketingContentPage locale={locale} slug={slug} />;
}
