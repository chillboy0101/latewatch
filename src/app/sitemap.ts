import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-05-02T00:00:00.000Z");

  return [
    {
      url: getSiteUrl("/"),
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: getSiteUrl("/check-in"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
