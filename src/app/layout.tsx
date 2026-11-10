import { Geist, Geist_Mono } from "next/font/google";
import "material-symbols/outlined.css";
import "./globals.css";
import "@/lib/backgroundServices"; // Model auto-sync + token health checks
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
import { RTL_LOCALES } from "@/i18n/config";
import { getSettings } from "@/lib/db/settings";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

/**
 * Runs before first paint. The theme lives in localStorage (zustand `persist`), which
 * React only reads after hydration — without this every page load flashes the light
 * palette before snapping to dark. Keep in sync with THEME_CONFIG and themeStore.
 */
const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;try{var t="dark";var s=localStorage.getItem("theme");if(s){var p=JSON.parse(s);if(p&&p.state&&typeof p.state.theme==="string")t=p.state.theme}if(t==="system")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.classList.toggle("dark",t==="dark")}catch(e){d.classList.add("dark")}})();`;

export async function generateMetadata() {
  const settings = await getSettings();
  const instanceName = settings?.instanceName || "Cool Router";
  const customFaviconUrl = settings?.customFaviconUrl || settings?.customFaviconBase64;

  return {
    title: `${instanceName} — One endpoint for every AI model`,
    description:
      "Cool Router is a fast, clean AI router. One OpenAI-compatible endpoint for every provider, with smart fallback.",
    icons: {
      icon: customFaviconUrl ? "/api/settings/favicon" : "/favicon.svg",
      apple: "/apple-touch-icon.svg",
    },
  };
}

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const isRtl = RTL_LOCALES.includes(locale as (typeof RTL_LOCALES)[number]);

  return (
    <html lang={locale} dir={isRtl ? "rtl" : "ltr"} className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:text-sm focus:font-semibold focus:shadow-lg"
        >
          Skip to content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
