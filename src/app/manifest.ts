import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, getSiteUrl } from "@/lib/site-metadata";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} Attendance`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#2563eb",
    categories: ["business", "productivity", "utilities"],
    lang: "en-GH",
    icons: [
      {
        src: getSiteUrl("/latewatch-logo.png"),
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: getSiteUrl("/apple-icon"),
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
