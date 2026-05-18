import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-metadata";

const privateRoutes = [
  "/api/",
  "/dashboard/",
  "/staff/",
  "/attendance/",
  "/location/",
  "/entries/",
  "/exports/",
  "/audit-trail/",
  "/emergency-contacts/",
  "/settings/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/check-in/"],
      disallow: privateRoutes,
    },
    sitemap: getSiteUrl("/sitemap.xml"),
  };
}
