import type { MetadataRoute } from "next";

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/features", "/pricing", "/whatsapp", "/security", "/contact", "/privacy", "/terms", "/acceptable-use", "/anti-spam"],
      disallow: ["/api/", "/dashboard", "/contacts", "/audiences", "/templates", "/campaigns"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
