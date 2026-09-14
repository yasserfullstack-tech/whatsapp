import type { MetadataRoute } from "next";
import { getPublicAppUrl } from "@/lib/public-app-url";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = getPublicAppUrl().toString().replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/features", "/pricing", "/whatsapp", "/security", "/contact", "/privacy", "/terms", "/acceptable-use", "/anti-spam"],
      disallow: ["/api/", "/dashboard", "/contacts", "/audiences", "/templates", "/campaigns"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
