import type { MetadataRoute } from "next";
import { marketingSlugs } from "@/lib/marketing-content";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
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
