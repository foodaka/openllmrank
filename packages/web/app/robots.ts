import type { MetadataRoute } from "next";

const SITE_URL = "https://openllmrank.io";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private funnel and app routes — no SEO value, keep out of the index.
      // "/check/" (trailing slash) blocks tokenized crawl reports while the
      // /check tool page itself stays indexable.
      disallow: ["/api/", "/wizard/", "/checkout/", "/reports/", "/check/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
