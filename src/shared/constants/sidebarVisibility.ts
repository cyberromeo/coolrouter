export const HIDEABLE_SIDEBAR_ITEM_IDS = [
  "home",
  "providers",
  "map",
  "connect",
  "combos",
  "api-manager",
  "playground",
  "analytics",
  "logs",
  "settings",
  "docs",
] as const;

export type HideableSidebarItemId = (typeof HIDEABLE_SIDEBAR_ITEM_IDS)[number];
export type SidebarSectionId = "primary" | "advanced" | "system";

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
  /** Folded away by default; the user opens it (remembered per browser) */
  collapsible?: boolean;
}

// The simple app: add providers, arrange models, connect apps.
const PRIMARY_SIDEBAR_ITEMS: readonly SidebarItemDefinition[] = [
  { id: "home", href: "/dashboard", i18nKey: "home", icon: "home", exact: true },
  { id: "providers", href: "/dashboard/providers", i18nKey: "providers", icon: "dns" },
  { id: "map", href: "/dashboard/map", i18nKey: "modelMap", icon: "account_tree" },
  { id: "connect", href: "/dashboard/connect", i18nKey: "connect", icon: "cable" },
];

// Power tools, folded away under "Advanced".
const ADVANCED_SIDEBAR_ITEMS: readonly SidebarItemDefinition[] = [
  { id: "combos", href: "/dashboard/combos", i18nKey: "combos", icon: "layers" },
  { id: "api-manager", href: "/dashboard/api-manager", i18nKey: "apiManager", icon: "vpn_key" },
  { id: "playground", href: "/dashboard/playground", i18nKey: "playground", icon: "science" },
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
    id: "advanced",
    titleKey: "advancedSection",
    titleFallback: "Advanced",
    items: ADVANCED_SIDEBAR_ITEMS,
    collapsible: true,
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
