"use client";

import { useState } from "react";

/**
 * Shown on the launch where Cool Router generated its own secrets (no JWT secret or
 * encryption key was configured). It is information, not a warning: nothing is wrong and
 * nothing needs doing, but the file it names must travel with the database.
 * Dismissable; shown only for the current session.
 *
 * `envFilePath` is resolved by the server (it knows the real data folder on every
 * platform, including Docker and a custom DATA_DIR); the browser cannot guess it.
 */
export default function BootstrapBanner({ envFilePath }: { envFilePath?: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
    >
      <span
        className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-text-muted"
        aria-hidden="true"
      >
        key
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-main">Encryption keys created</p>
        <p className="mt-0.5 leading-relaxed text-text-muted">
          Cool Router generated the keys that protect your sign-in and stored credentials and saved
          them to{" "}
          {envFilePath ? (
            <code className="break-all rounded bg-bg px-1 py-0.5 font-mono text-xs text-text-main">
              {envFilePath}
            </code>
          ) : (
            <>
              <code className="rounded bg-bg px-1 py-0.5 font-mono text-xs text-text-main">
                server.env
              </code>{" "}
              in your data folder
            </>
          )}
          . Keep that file with the database when you back up or move your data.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-main"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}
