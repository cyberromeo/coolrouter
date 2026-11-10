"use client";

/**
 * Breadcrumbs — trail for pages nested below a top-level section.
 *
 * Top-level pages (/dashboard/providers, /dashboard/logs, …) already show their name
 * in the header, and provider detail pages get their own trail there, so this renders
 * only for the remaining nested pages (e.g. Providers › New).
 * Uses usePathname() internally — no props needed.
 */

import { usePathname } from "next/navigation";
import Link from "next/link";

const PATH_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  providers: "Providers",
  combos: "Combos",
  settings: "Settings",
  logs: "Logs",
  "api-manager": "API Keys",
  analytics: "Usage",
  playground: "Playground",
  new: "New",
  add: "Add",
  edit: "Edit",
  keys: "API Keys",
  models: "Models",
};

export default function Breadcrumbs() {
  const pathname = usePathname();
  if (!pathname) return null;

  // Drop the "dashboard" root: every page lives under it, so it says nothing.
  const segments = pathname.split("/").filter(Boolean);
  const trail = segments[0] === "dashboard" ? segments.slice(1) : segments;
  if (trail.length < 2) return null;
  // Ids (provider connections, UUIDs) are not labels; the header names those pages.
  if (trail.some((segment) => !PATH_LABELS[segment])) return null;

  const base = segments[0] === "dashboard" ? "/dashboard" : "";
  const crumbs = trail.map((segment, index) => ({
    label: PATH_LABELS[segment],
    href: `${base}/${trail.slice(0, index + 1).join("/")}`,
    isLast: index === trail.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-[13px]">
      {crumbs.map((crumb, index) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          {index > 0 && (
            <span
              className="material-symbols-outlined text-[14px] text-text-muted/60"
              aria-hidden="true"
            >
              chevron_right
            </span>
          )}
          {crumb.isLast ? (
            <span aria-current="page" className="font-medium text-text-main">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="rounded text-text-muted transition-colors hover:text-text-main"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
