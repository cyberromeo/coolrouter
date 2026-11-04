"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import CoolRouterLogo from "./CoolRouterLogo";
import { useTranslations } from "next-intl";
import {
  HIDDEN_SIDEBAR_ITEMS_SETTING_KEY,
  SIDEBAR_SETTINGS_UPDATED_EVENT,
  SIDEBAR_SECTIONS,
  normalizeHiddenSidebarItems,
} from "@/shared/constants/sidebarVisibility";

export default function Sidebar({
  onClose,
  collapsed = false,
  onToggleCollapse,
  isMacElectron = false,
}: {
  onClose?: any;
  collapsed?: boolean;
  onToggleCollapse?: any;
  isMacElectron?: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");
  const [showDebug, setShowDebug] = useState(false);
  const [hiddenSidebarItems, setHiddenSidebarItems] = useState<string[]>([]);
  const [customAppName, setCustomAppName] = useState<string | null>(null);
  const [customLogo, setCustomLogo] = useState<string | null>(null);

  useEffect(() => {
    const applySettings = (data) => {
      setShowDebug(data?.debugMode === true);
      setHiddenSidebarItems(normalizeHiddenSidebarItems(data?.[HIDDEN_SIDEBAR_ITEMS_SETTING_KEY]));
      setCustomAppName(data?.instanceName || null);
      setCustomLogo(data?.customLogoBase64 || data?.customLogoUrl || null);
    };

    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => applySettings(data))
      .catch(() => {});

    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};

      if ("debugMode" in detail) {
        setShowDebug(detail.debugMode === true);
      }

      if (HIDDEN_SIDEBAR_ITEMS_SETTING_KEY in detail) {
        setHiddenSidebarItems(
          normalizeHiddenSidebarItems(detail[HIDDEN_SIDEBAR_ITEMS_SETTING_KEY])
        );
      }

      if ("instanceName" in detail) {
        setCustomAppName((detail.instanceName as string) || null);
      }

      if ("customLogoBase64" in detail) {
        setCustomLogo((detail.customLogoBase64 as string) || null);
      } else if ("customLogoUrl" in detail) {
        setCustomLogo((detail.customLogoUrl as string) || null);
      }
    };

    window.addEventListener(SIDEBAR_SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener);

    return () => {
      window.removeEventListener(
        SIDEBAR_SETTINGS_UPDATED_EVENT,
        handleSettingsUpdated as EventListener
      );
    };
  }, []);

  const isActive = (href, exact) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const getSidebarLabel = (key: string, fallback: string) =>
    typeof t.has === "function" && t.has(key) ? t(key) : fallback;

  const hiddenSidebarSet = new Set(hiddenSidebarItems);
  const visibleSections = SIDEBAR_SECTIONS.filter(
    (section) => section.visibility !== "debug" || showDebug
  )
    .map((section) => ({
      ...section,
      title: getSidebarLabel(section.titleKey, section.titleFallback),
      items: section.items
        .map((item) => ({ ...item, label: t(item.i18nKey) }))
        .filter((item) => !hiddenSidebarSet.has(item.id)),
    }))
    .filter((section) => section.items.length > 0);

  const renderNavLink = (item) => {
    const active = !item.external && isActive(item.href, item.exact);
    const className = cn(
      "flex items-center gap-3 rounded-md transition-colors group",
      collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5",
      active
        ? "bg-black/[0.06] text-text-main dark:bg-white/[0.08]"
        : "text-text-muted hover:bg-black/[0.04] hover:text-text-main dark:hover:bg-white/[0.05]"
    );
    const iconClassName = cn(
      "material-symbols-outlined text-[18px]",
      active ? "fill-1" : "transition-colors"
    );
    const content = (
      <>
        <span className={iconClassName}>{item.icon}</span>
        {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
      </>
    );

    if (item.external) {
      return (
        <a
          key={item.href}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          title={collapsed ? item.label : undefined}
          className={className}
        >
          {content}
        </a>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        title={collapsed ? item.label : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  };

  return (
    <>
      <aside
        className={cn(
          "flex h-full min-h-0 flex-col border-r border-border bg-sidebar transition-all duration-300 ease-in-out",
          collapsed ? "w-16" : "w-64"
        )}
        style={{
          paddingTop: isMacElectron ? "var(--desktop-safe-top)" : undefined,
        }}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:m-2"
        >
          Skip to content
        </a>
        {(onToggleCollapse || !isMacElectron) && (
          <div
            className={cn(
              "flex items-center gap-2 pb-2",
              isMacElectron ? "pt-3" : "pt-4",
              collapsed ? "px-3 justify-center" : "px-4"
            )}
            aria-hidden="true"
          >
            {!collapsed && <div className="flex-1" />}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn(
                  "rounded-md p-1 text-text-muted/50 transition-colors hover:bg-black/5 hover:text-text-muted dark:hover:bg-white/5",
                  collapsed && !isMacElectron && "mt-2",
                  isMacElectron && "ml-auto"
                )}
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  {collapsed ? "chevron_right" : "chevron_left"}
                </span>
              </button>
            )}
          </div>
        )}

        <div className={cn("pb-4 pt-1", collapsed ? "px-2" : "px-4")}>
          <Link
            href="/dashboard"
            className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}
          >
            <div className="flex items-center justify-center size-8 rounded-md bg-primary text-primary-foreground shrink-0">
              {customLogo ? (
                <img
                  src={customLogo}
                  alt={customAppName || APP_CONFIG.name}
                  className="size-5 object-contain"
                />
              ) : (
                <CoolRouterLogo size={18} />
              )}
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <h1 className="text-[15px] font-semibold tracking-tight text-text-main leading-tight">
                  {customAppName || APP_CONFIG.name}
                </h1>
                <span className="font-mono text-[11px] text-text-muted">v{APP_CONFIG.version}</span>
              </div>
            )}
          </Link>
        </div>

        <nav
          aria-label="Main navigation"
          className={cn(
            "min-h-0 flex-1 space-y-1 overflow-y-auto py-2 custom-scrollbar",
            collapsed ? "px-2" : "px-3"
          )}
        >
          {visibleSections.map((section) => {
            const showTitle = section.showTitleInSidebar !== false;

            return (
              <div key={section.id} className={showTitle ? "pt-4 mt-2" : undefined}>
                {!collapsed && showTitle && (
                  <p className="px-3 text-[11px] font-medium text-text-muted/70 uppercase tracking-wider mb-1.5">
                    {section.title}
                  </p>
                )}
                {collapsed && showTitle && <div className="border-t border-border mb-2" />}
                {section.items.map(renderNavLink)}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
  isMacElectron: PropTypes.bool,
};
