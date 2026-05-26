import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, getSiteUrl } from "@/lib/site-metadata";

type ChromiumPushManifest = MetadataRoute.Manifest & {
  gcm_sender_id: string;
};

export default function manifest(): MetadataRoute.Manifest {
  const data = {
    name: `${SITE_NAME} Attendance`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/check-in",
    scope: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#2563eb",
    categories: ["business", "productivity", "utilities"],
    gcm_sender_id: "103953800507",
    lang: "en-GH",
    icons: [
      {
        src: getSiteUrl("/latewatch-logo.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: getSiteUrl("/latewatch-logo.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: getSiteUrl("/apple-icon"),
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  } satisfies ChromiumPushManifest;

  return data;
}
