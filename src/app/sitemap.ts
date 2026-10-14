import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/supabase/config";

// Only public marketing pages: anything requiring a sign-in is left out.
const PUBLIC_PATHS = ["/", "/features", "/use-cases", "/how-it-works", "/pricing", "/faq", "/contact", "/login", "/register"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
