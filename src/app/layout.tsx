import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { HtmlLocaleSync } from "@/components/i18n/html-locale-sync";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "InvestAtlas",
  title: "InvestAtlas — Multi-Asset Portfolio, Tax & Strategy Lab",
  description: "Track crypto, stocks, gold, and silver in one portfolio, analyze price history, backtest strategies, and review German tax estimates.",
  keywords: ["investing", "crypto", "stocks", "gold", "silver", "portfolio", "tax", "FIFO", "SMA", "backtesting", "strategy", "TradingView"],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "InvestAtlas",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/app-icon.svg", type: "image/svg+xml" },
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var raw = localStorage.getItem('investatlas.preferences');
              var pref = raw ? (JSON.parse(raw).theme || 'dark') : 'dark';
              if (pref === 'system') {
                pref = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
              }
              document.documentElement.setAttribute('data-theme', pref);
            } catch (e) {
              document.documentElement.setAttribute('data-theme', 'dark');
            }
          })();
        ` }} />
        <HtmlLocaleSync />
        <AuthProvider>
          {children}
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
