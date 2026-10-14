import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/supabase/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Every authenticated area; crawlers never see real company data anyway
        // (it's behind sign-in), but there is no reason to send them there.
        disallow: ["/dashboard", "/tables", "/employees", "/company", "/account", "/founder", "/onboarding", "/api"],
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
