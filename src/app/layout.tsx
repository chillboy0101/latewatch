import type { Metadata, Viewport } from "next";
import { ClerkThemeProvider } from "@/components/auth/clerk-theme-provider";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationProvider } from "@/contexts/notification-context";
import { PushReminderToast } from "@/components/notifications/push-reminder-toast";
import { ThemeColorSync } from "@/components/layout/theme-color-sync";
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  getSiteUrl,
} from "@/lib/site-metadata";
import "./globals.css";


export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: "Ghana Revenue Authority" }],
  category: "Business",
  creator: SITE_NAME,
  keywords: SITE_KEYWORDS,
  publisher: "Ghana Revenue Authority",
  referrer: "origin-when-cross-origin",
  alternates: {
    canonical: "/",
  },
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/latewatch-logo.png", sizes: "1024x1024", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // Transparent status bar on the installed iOS PWA so it shows the app's
    // themed background (dark in dark mode) instead of a fixed white bar.
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE_NAME,
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "en_GH",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  // Extend the page under the notch/status bar so the transparent iOS PWA status
  // bar shows the app background, and env(safe-area-inset-*) becomes non-zero.
  viewportFit: "cover",
  // Single (non-media) theme-color so it can be driven by the app's manual
  // theme toggle. Media-based metas would win over our dynamic one whenever the
  // OS preference matched, leaving the status bar out of sync with the app.
  themeColor: "#0a0a0a",
};

const themeScript = `
  (function() {
    var theme = localStorage.getItem('theme');
    var isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
    }
    var color = isDark ? '#0a0a0a' : '#ffffff';
    // Drop any media-based theme-color metas so they can't override ours when
    // the OS preference matches.
    document.querySelectorAll('meta[name="theme-color"][media]').forEach(function(m){ m.remove(); });
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ClerkThemeProvider>
          <NotificationProvider>
            <ThemeColorSync />
            <AppShell>{children}</AppShell>
            <PushReminderToast />
          </NotificationProvider>
        </ClerkThemeProvider>
      </body>
    </html>
  );
}
