import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE } from "./config";
import type { Locale } from "./config";
import { withFallbackMessages, type Messages } from "./fallbackMessages";
import defaultMessages from "./messages/en.json";

export default getRequestConfig(async () => {
  // 1. Try cookie
  const cookieStore = await cookies();
  let locale: string = cookieStore.get(LOCALE_COOKIE)?.value || "";

  // 2. Try custom header (set by middleware)
  if (!locale) {
    const headerStore = await headers();
    locale = headerStore.get("x-locale") || "";
  }

  // 3. Validate & fallback
  if (!LOCALES.includes(locale as Locale)) {
    locale = DEFAULT_LOCALE;
  }

  // Untranslated keys fall back to English (see withFallbackMessages).
  const messages =
    locale === DEFAULT_LOCALE
      ? (defaultMessages as Messages)
      : withFallbackMessages(
          defaultMessages as Messages,
          (await import(`./messages/${locale}.json`)).default as Messages
        );

  return {
    locale,
    messages,
  };
});
