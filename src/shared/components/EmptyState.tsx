"use client";

/**
 * EmptyState — what a section shows when there is nothing in it yet, with an optional
 * action to create the first item.
 *
 * Usage:
 *   <EmptyState
 *     icon="hub"
 *     title="No providers yet"
 *     description="Add your first API provider to get started."
 *     actionLabel="Add provider"
 *     onAction={() => router.push("/dashboard/providers/new")}
 *   />
 *
 * `icon` is a Material Symbols name ("hub", "timeline"). An emoji or any other
 * non-identifier string is rendered as-is for backwards compatibility.
 */

import Button from "./Button";

interface EmptyStateProps {
  icon?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: (() => void) | null;
}

const ICON_NAME = /^[a-z0-9_]+$/;

export default function EmptyState({
  icon = "inbox",
  title = "Nothing here yet",
  description = "",
  actionLabel = "",
  onAction = null,
}: EmptyStateProps) {
  const isIconName = ICON_NAME.test(icon);

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <div
        className="mb-4 flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-text-muted"
        aria-hidden="true"
      >
        {isIconName ? (
          <span className="material-symbols-outlined text-[22px]">{icon}</span>
        ) : (
          <span className="text-xl leading-none">{icon}</span>
        )}
      </div>
      <h3 className="text-base font-semibold text-text-main">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button className="mt-5" icon="add" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
