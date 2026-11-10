export type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Messages {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Lay a locale's messages over the English ones. Translations lag behind new UI text,
 * and next-intl renders a missing key as its raw path ("updates.available"), so every
 * key a locale has not translated yet falls back to English instead.
 */
export function withFallbackMessages(fallback: Messages, messages: Messages): Messages {
  const merged: Messages = { ...fallback };
  for (const [key, value] of Object.entries(messages)) {
    const base = fallback[key];
    merged[key] =
      isPlainObject(base) && isPlainObject(value) ? withFallbackMessages(base, value) : value;
  }
  return merged;
}
