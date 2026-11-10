"use client";

/**
 * Maintenance Banner — Phase 8.4
 *
 * Shows a warning banner at the top of the dashboard when the server
 * is restarting or in maintenance mode. Auto-dismisses when the server
 * comes back online.
 */

import { useState, useEffect } from "react";
import { useRef } from "react";
import { useTranslations } from "next-intl";

export default function MaintenanceBanner() {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const consecutiveFailuresRef = useRef(0);
  const dismissedUntilRecoveryRef = useRef(false);
  const t = useTranslations("common");

  useEffect(() => {
    const checkHealth = async () => {
      // Nobody is looking: skip the probe (it runs every 10s for as long as the tab lives).
      if (typeof document !== "undefined" && document.hidden) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch("/api/monitoring/health", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.ok) {
          consecutiveFailuresRef.current = 0;
          dismissedUntilRecoveryRef.current = false;
          setShow(false);
          setMessage("");
        } else {
          consecutiveFailuresRef.current += 1;
          // Require at least 2 failed checks to avoid transient false positives.
          if (consecutiveFailuresRef.current >= 2 && !dismissedUntilRecoveryRef.current) {
            setShow(true);
            setMessage(t("maintenanceServerIssues"));
          }
        }
      } catch {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 2 && !dismissedUntilRecoveryRef.current) {
          setShow(true);
          setMessage(t("maintenanceServerUnreachable"));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // Run immediately on mount, then every 10 seconds
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    // Catch up as soon as the tab is shown again instead of up to 10s later.
    document.addEventListener("visibilitychange", checkHealth);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkHealth);
    };
  }, [t]);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-3 animate-in slide-in-from-top"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="material-symbols-outlined text-amber-600 dark:text-amber-500 text-[18px] animate-pulse"
          aria-hidden="true"
        >
          warning
        </span>
        {/* amber-200 is a pale yellow: invisible on the light theme's near-white banner */}
        <span className="text-sm text-amber-800 dark:text-amber-200">{message}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          dismissedUntilRecoveryRef.current = true;
          setShow(false);
        }}
        className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-text-main transition-colors"
        aria-label={t("close")}
      >
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}
