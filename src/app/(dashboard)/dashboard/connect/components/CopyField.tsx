"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";

interface CopyFieldProps {
  value: string;
  label?: string;
  /** Show as a multi-line code block */
  block?: boolean;
  /** Hide the value until revealed (API keys) */
  secret?: boolean;
  className?: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
}

function mask(value: string) {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 7)}••••••••${value.slice(-4)}`;
}

/** A value with a copy button; the copy always takes the full value. */
export default function CopyField({ value, label, block, secret, className }: CopyFieldProps) {
  const t = useTranslations("connect");
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  const onCopy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      {label && <div className="mb-1 text-xs font-medium text-text-muted">{label}</div>}
      <div
        className={cn(
          "group relative flex min-w-0 rounded-lg border border-border bg-bg",
          block ? "items-start" : "items-center"
        )}
      >
        {block ? (
          <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 pr-20 font-mono text-[12.5px] leading-relaxed text-text-main">
            {revealed ? value : mask(value)}
          </pre>
        ) : (
          <code className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-[12.5px] text-text-main">
            {revealed ? value : mask(value)}
          </code>
        )}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 pr-1.5",
            block && "absolute right-0 top-1.5"
          )}
        >
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-black/5 hover:text-text-main dark:hover:bg-white/10"
              aria-label={revealed ? t("hide") : t("show")}
              title={revealed ? t("hide") : t("show")}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {revealed ? "visibility_off" : "visibility"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
              copied
                ? "text-success"
                : "text-text-muted hover:bg-black/5 hover:text-text-main dark:hover:bg-white/10"
            )}
            aria-label={t("copy")}
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      </div>
    </div>
  );
}
