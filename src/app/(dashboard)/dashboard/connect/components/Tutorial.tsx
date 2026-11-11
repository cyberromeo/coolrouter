"use client";

import type { ReactNode } from "react";

export interface TutorialStep {
  title: ReactNode;
  body?: ReactNode;
}

/** Numbered steps with an optional detail under each. */
export default function Tutorial({ steps }: { steps: TutorialStep[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-xs font-semibold text-text-main"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-sm font-medium text-text-main">{step.title}</div>
            {step.body && <div className="mt-1.5 text-sm text-text-muted">{step.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Menu path such as Help → Troubleshooting → Enable Developer Mode. */
export function MenuPath({ items }: { items: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && (
            <span
              className="material-symbols-outlined text-[14px] text-text-muted"
              aria-hidden="true"
            >
              chevron_right
            </span>
          )}
          <kbd className="rounded-md border border-border bg-bg px-1.5 py-0.5 font-sans text-xs font-medium text-text-main">
            {item}
          </kbd>
        </span>
      ))}
    </span>
  );
}
