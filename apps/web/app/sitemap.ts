import type { MetadataRoute } from "next";
import { marketingSlugs } from "@/lib/marketing-content";
import { getPublicAppUrl } from "@/lib/public-app-url";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getPublicAppUrl().toString().replace(/\/$/, "");
  const now = new Date();

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...marketingSlugs.map((slug) => ({
      url: `${base}/${slug}`,
      lastModified: now,
      changeFrequency: slug === "pricing" || slug === "features" ? ("weekly" as const) : ("monthly" as const),
      priority: slug === "features" || slug === "pricing" || slug === "whatsapp" ? 0.9 : 0.6,
    })),
  ];
}
