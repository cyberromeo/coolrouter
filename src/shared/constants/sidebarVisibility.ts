export const HIDEABLE_SIDEBAR_ITEM_IDS = [
  "home",
  "providers",
  "combos",
  "api-manager",
  "playground",
  "analytics",
  "logs",
  "settings",
  "docs",
] as const;

export type HideableSidebarItemId = (typeof HIDEABLE_SIDEBAR_ITEM_IDS)[number];
export type SidebarSectionId = "primary" | "monitor" | "system";

export interface SidebarItemDefinition {
  id: HideableSidebarItemId;
  href: string;
  i18nKey: string;
  icon: string;
  exact?: boolean;
  external?: boolean;
}

export interface SidebarSectionDefinition {
  id: SidebarSectionId;
  titleKey: string;
  titleFallback: string;
  items: readonly SidebarItemDefinition[];
  showTitleInSidebar?: boolean;
  visibility?: "always" | "debug";
}

const PRIMARY_SIDEBAR_ITEMS: readonly SidebarItemDefinition[] = [
  { id: "home", href: "/dashboard", i18nKey: "home", icon: "home", exact: true },
  { id: "providers", href: "/dashboard/providers", i18nKey: "providers", icon: "dns" },
  { id: "combos", href: "/dashboard/combos", i18nKey: "combos", icon: "layers" },
  { id: "api-manager", href: "/dashboard/api-manager", i18nKey: "apiManager", icon: "vpn_key" },
  { id: "playground", href: "/dashboard/playground", i18nKey: "playground", icon: "science" },
];

const MONITOR_SIDEBAR_ITEMS: readonly SidebarItemDefinition[] = [
  { id: "analytics", href: "/dashboard/analytics", i18nKey: "analytics", icon: "monitoring" },
  { id: "logs", href: "/dashboard/logs", i18nKey: "logs", icon: "receipt_long" },
];

const SYSTEM_SIDEBAR_ITEMS: readonly SidebarItemDefinition[] = [
  { id: "settings", href: "/dashboard/settings", i18nKey: "settings", icon: "settings" },
  {
    id: "docs",
    href: "https://github.com/cyberromeo/coolrouter#readme",
    i18nKey: "docs",
    icon: "menu_book",
    external: true,
  },
];

export const SIDEBAR_SECTIONS: readonly SidebarSectionDefinition[] = [
  {
    id: "primary",
    titleKey: "primarySection",
    titleFallback: "Main",
    items: PRIMARY_SIDEBAR_ITEMS,
    showTitleInSidebar: false,
  },
  {
    id: "monitor",
    titleKey: "monitorSection",
    titleFallback: "Monitor",
    items: MONITOR_SIDEBAR_ITEMS,
  },
  {
    id: "system",
    titleKey: "systemSection",
    titleFallback: "System",
    items: SYSTEM_SIDEBAR_ITEMS,
  },
] as const;

export const HIDDEN_SIDEBAR_ITEMS_SETTING_KEY = "hiddenSidebarItems";
export const SIDEBAR_SETTINGS_UPDATED_EVENT = "coolrouter:settings-updated";

export function normalizeHiddenSidebarItems(value: unknown): HideableSidebarItemId[] {
  if (!Array.isArray(value)) return [];

  const hiddenItems = new Set<HideableSidebarItemId>();

  for (const item of value) {
    if (
      typeof item === "string" &&
      HIDEABLE_SIDEBAR_ITEM_IDS.includes(item as HideableSidebarItemId)
    ) {
      hiddenItems.add(item as HideableSidebarItemId);
    }
  }

  return HIDEABLE_SIDEBAR_ITEM_IDS.filter((item) => hiddenItems.has(item));
}
