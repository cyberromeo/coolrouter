"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { useTranslations } from "next-intl";
import SystemStorageTab from "./components/SystemStorageTab";
import SecurityTab from "./components/SecurityTab";
import RoutingTab from "./components/RoutingTab";
import ComboDefaultsTab from "./components/ComboDefaultsTab";
import ProxyTab from "./components/ProxyTab";
import AppearanceTab from "./components/AppearanceTab";
import ModelAliasesTab from "./components/ModelAliasesTab";
import UpdatesCard from "./components/UpdatesCard";

const tabs = [
  { id: "general", labelKey: "general", icon: "settings" },
  { id: "security", labelKey: "security", icon: "shield" },
  { id: "routing", labelKey: "routing", icon: "route" },
  { id: "advanced", labelKey: "advanced", icon: "tune" },
];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [userSelectedTab, setUserSelectedTab] = useState(null);
  const activeTab = userSelectedTab || tabs.find((t) => t.id === tabParam)?.id || "general";

  return (
    <div className="max-w-6xl mx-auto min-w-0">
      <div className="flex flex-col gap-6">
        {/* Tab navigation */}
        <div className="w-full overflow-x-auto pb-1">
          <div
            role="tablist"
            aria-label={t("settingsSectionsAria")}
            className="inline-flex items-center gap-1 border-b border-border min-w-max w-full"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setUserSelectedTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 -mb-px border-b-2 font-medium transition-colors text-sm",
                  activeTab === tab.id
                    ? "border-text-main text-text-main"
                    : "border-transparent text-text-muted hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="hidden sm:inline whitespace-nowrap">{t(tab.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab contents */}
        <div
          role="tabpanel"
          aria-label={t(tabs.find((t2) => t2.id === activeTab)?.labelKey || "general")}
        >
          {activeTab === "general" && (
            <div className="flex flex-col gap-6">
              <UpdatesCard />
              <AppearanceTab />
              <SystemStorageTab />
            </div>
          )}

          {activeTab === "security" && <SecurityTab />}

          {activeTab === "routing" && (
            <div className="flex flex-col gap-6">
              <RoutingTab />
              <ComboDefaultsTab />
              <ModelAliasesTab />
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="flex flex-col gap-6">
              <ProxyTab />
            </div>
          )}
        </div>

        {/* App Info */}
        <div className="text-center text-sm text-text-muted py-4">
          <p>
            {APP_CONFIG.name} v{APP_CONFIG.version}
          </p>
          <p className="mt-1">{t("localMode")}</p>
        </div>
      </div>
    </div>
  );
}
