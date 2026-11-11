"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";
import { useNotificationStore } from "@/store/notificationStore";
import CopyField from "./CopyField";
import { postJson } from "../useConnection";

type Snippet = "openai" | "anthropic" | "curl";

interface Credentials {
  apiKey: string;
  baseUrl: string;
  openaiBaseUrl: string;
  model: string;
}

function snippetFor(kind: Snippet, c: Credentials): string {
  if (kind === "openai") {
    return [
      "from openai import OpenAI",
      "",
      `client = OpenAI(base_url="${c.openaiBaseUrl}", api_key="${c.apiKey}")`,
      "reply = client.chat.completions.create(",
      `    model="${c.model}",`,
      '    messages=[{"role": "user", "content": "Hello!"}],',
      ")",
      "print(reply.choices[0].message.content)",
    ].join("\n");
  }
  if (kind === "anthropic") {
    return [
      "import anthropic",
      "",
      `client = anthropic.Anthropic(base_url="${c.baseUrl}", api_key="${c.apiKey}")`,
      "reply = client.messages.create(",
      '    model="claude-sonnet-5-5",',
      "    max_tokens=1024,",
      '    messages=[{"role": "user", "content": "Hello!"}],',
      ")",
      "print(reply.content[0].text)",
    ].join("\n");
  }
  return [
    `curl ${c.openaiBaseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer ${c.apiKey}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model": "${c.model}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
  ].join("\n");
}

/** Any OpenAI- or Anthropic-compatible app: address, key and a snippet. */
export default function OtherAppCard() {
  const t = useTranslations("connect");
  const notify = useNotificationStore();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Snippet>("openai");

  const reveal = async () => {
    setBusy(true);
    try {
      setCredentials(await postJson("/api/cli-tools/other", {}));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg">
          <span className="material-symbols-outlined text-[24px] text-text-main" aria-hidden="true">
            apps
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text-main">{t("other.title")}</h2>
          <p className="mt-0.5 text-sm text-text-muted">{t("other.subtitle")}</p>
        </div>
        {!credentials && (
          <Button variant="secondary" icon="key" loading={busy} onClick={reveal}>
            {t("other.reveal")}
          </Button>
        )}
      </div>
      {credentials && (
        <div className="flex flex-col gap-4 border-t border-border px-5 py-5">
          <div className="grid gap-3 md:grid-cols-3">
            <CopyField label={t("other.openaiBase")} value={credentials.openaiBaseUrl} />
            <CopyField label={t("other.apiKey")} value={credentials.apiKey} secret />
            <CopyField label={t("other.model")} value={credentials.model} />
          </div>
          <p className="text-xs text-text-muted">{t("other.modelHint")}</p>
          <div
            role="radiogroup"
            aria-label={t("format")}
            className="flex w-fit rounded-lg border border-border bg-bg p-0.5"
          >
            {(["openai", "anthropic", "curl"] as Snippet[]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  kind === option ? "bg-text-main text-bg" : "text-text-muted hover:text-text-main"
                )}
              >
                {t(`other.snippets.${option}`)}
              </button>
            ))}
          </div>
          <CopyField block secret value={snippetFor(kind, credentials)} />
        </div>
      )}
    </section>
  );
}
