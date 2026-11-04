"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/shared/components";

type Stats = {
  providers: number | null;
  keys: number | null;
  combos: number | null;
  models: number | null;
  requests: number | null;
  tokens: number | null;
};

const EMPTY_STATS: Stats = {
  providers: null,
  keys: null,
  combos: null,
  models: null,
  requests: null,
  tokens: null,
};

async function getJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-muted transition-colors hover:text-text-main"
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

function StatTile({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-black/20 dark:hover:border-white/25"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-text-main">{value}</p>
    </Link>
  );
}

export default function HomePageClient(_props: { machineId?: string }) {
  const [origin] = useState(() =>
    typeof window === "undefined" ? "http://localhost:20128" : window.location.origin
  );
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [snippet, setSnippet] = useState<"curl" | "python" | "node">("curl");

  useEffect(() => {
    Promise.all([
      getJson("/api/providers"),
      getJson("/api/keys"),
      getJson("/api/combos"),
      getJson("/api/models"),
      getJson("/api/usage/analytics?range=24h"),
    ]).then(([providers, keys, combos, models, usage]) => {
      setStats({
        providers: Array.isArray(providers?.connections) ? providers.connections.length : null,
        keys: typeof keys?.total === "number" ? keys.total : null,
        combos: Array.isArray(combos?.combos) ? combos.combos.length : null,
        models: Array.isArray(models?.models)
          ? models.models.length
          : Array.isArray(models?.data)
            ? models.data.length
            : null,
        requests: usage?.summary?.totalRequests ?? null,
        tokens: usage?.summary?.totalTokens ?? null,
      });
    });
  }, []);

  const baseUrl = `${origin}/v1`;

  const snippets = useMemo(
    () => ({
      curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COOL_ROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "<provider>/<model>", "messages": [{"role": "user", "content": "Hello!"}]}'`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="<your Cool Router key>")
reply = client.chat.completions.create(
    model="<provider>/<model>",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`,
      node: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${baseUrl}", apiKey: "<your Cool Router key>" });
const reply = await client.chat.completions.create({
  model: "<provider>/<model>",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(reply.choices[0].message.content);`,
    }),
    [baseUrl]
  );

  const steps = [
    {
      done: (stats.providers ?? 0) > 0,
      title: "Connect a provider",
      desc: "Add an API key or sign in to OpenAI, Anthropic, Gemini, OpenRouter and more.",
      href: "/dashboard/providers",
      cta: "Add provider",
    },
    {
      done: (stats.keys ?? 0) > 0,
      title: "Create an API key",
      desc: "Your apps use this key to talk to Cool Router.",
      href: "/dashboard/api-manager",
      cta: "Create key",
    },
    {
      done: (stats.combos ?? 0) > 0,
      title: "Add a fallback combo (optional)",
      desc: "Chain models so a rate limit or outage never stops you.",
      href: "/dashboard/combos",
      cta: "New combo",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Endpoint */}
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your endpoint</h2>
            <p className="text-sm text-text-muted">
              Works with any OpenAI-compatible app, SDK or coding tool.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              suppressHydrationWarning
              className="flex-1 truncate rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text-main"
            >
              {baseUrl}
            </code>
            <CopyButton value={baseUrl} label="Copy URL" />
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border bg-bg px-2">
              <div className="flex">
                {(["curl", "python", "node"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSnippet(id)}
                    className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                      snippet === id
                        ? "border-text-main text-text-main"
                        : "border-transparent text-text-muted hover:text-text-main"
                    }`}
                  >
                    {id === "curl" ? "cURL" : id === "python" ? "Python" : "Node.js"}
                  </button>
                ))}
              </div>
              <CopyButton value={snippets[snippet]} />
            </div>
            <pre
              suppressHydrationWarning
              className="overflow-x-auto bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text-main"
            >
              {snippets[snippet]}
            </pre>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Providers"
          value={formatNumber(stats.providers)}
          href="/dashboard/providers"
        />
        <StatTile label="Models" value={formatNumber(stats.models)} href="/dashboard/playground" />
        <StatTile
          label="Requests · 24h"
          value={formatNumber(stats.requests)}
          href="/dashboard/logs"
        />
        <StatTile
          label="Tokens · 24h"
          value={formatNumber(stats.tokens)}
          href="/dashboard/analytics"
        />
      </div>

      {/* Getting started */}
      <Card>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Get started</h2>
        <p className="mb-4 text-sm text-text-muted">Three steps and you&apos;re routing.</p>
        <ol className="flex flex-col divide-y divide-border">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-center gap-4 py-3">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  step.done
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border text-text-muted"
                }`}
              >
                {step.done ? (
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    check
                  </span>
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-main">{step.title}</p>
                <p className="text-sm text-text-muted">{step.desc}</p>
              </div>
              <Link
                href={step.href}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-xs font-medium text-text-main transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                {step.cta}
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
