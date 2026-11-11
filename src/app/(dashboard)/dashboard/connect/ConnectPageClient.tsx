"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ClaudeCodeCard from "./components/ClaudeCodeCard";
import ClaudeDesktopCard from "./components/ClaudeDesktopCard";
import CodexCard from "./components/CodexCard";
import OtherAppCard from "./components/OtherAppCard";

/** Connect page: one card per app, each with one-click setup and a tutorial. */
export default function ConnectPageClient() {
  const t = useTranslations("connect");
  const [mapEmpty, setMapEmpty] = useState(false);

  useEffect(() => {
    fetch("/api/model-map", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const routes = data?.map?.routes;
        if (routes) {
          setMapEmpty(
            ["opus", "sonnet", "haiku"].every((tier) => (routes[tier]?.models ?? []).length === 0)
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-sm text-text-muted">{t("intro")}</p>
      {mapEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
          <p className="text-sm text-text-main">{t("mapEmptyWarning")}</p>
          <Link href="/dashboard/map" className="text-sm font-medium text-accent hover:underline">
            {t("mapEmptyAction")}
          </Link>
        </div>
      )}
      <ClaudeCodeCard />
      <ClaudeDesktopCard />
      <CodexCard />
      <OtherAppCard />
    </div>
  );
}
