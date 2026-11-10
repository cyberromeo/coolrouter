"use client";

import { useState, useRef, useEffect } from "react";
import { RequestLoggerV2 } from "@/shared/components";
import { readApiError } from "@/shared/utils/apiErrorMessage";
import { useNotificationStore } from "@/store/notificationStore";
import { useTranslations } from "next-intl";

const TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
];

export default function LogsPage() {
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("logs");
  const notify = useNotificationStore();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowExport(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleExport(hours: number) {
    setExporting(true);
    setShowExport(false);
    try {
      const logType = "request-logs";
      const res = await fetch(`/api/logs/export?hours=${hours}&type=${logType}`);
      if (!res.ok) throw new Error(await readApiError(res, "Export failed"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cool-router-${logType}-${hours}h-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      // Without this the button just went back to "Export" and nothing was downloaded.
      notify.error(err instanceof Error && err.message ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">{t("requestLogs")}</h2>

        <div className="relative" ref={dropdownRef}>
          <button
            id="export-logs-btn"
            onClick={() => setShowExport(!showExport)}
            disabled={exporting}
            className="flex items-center gap-2 h-9 px-3 text-sm font-medium rounded-md bg-surface border border-border text-text-muted hover:text-text-main transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M8 2v8m0 0l-3-3m3 3l3-3M3 12h10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {exporting ? "Exporting..." : "Export"}
          </button>

          {showExport && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md bg-surface border border-border shadow-elevated overflow-hidden">
              <div className="px-3 py-2 text-xs text-text-muted border-b border-border font-medium">
                Time Range
              </div>
              {TIME_RANGES.map((range) => (
                <button
                  key={range.hours}
                  id={`export-${range.hours}h-btn`}
                  onClick={() => handleExport(range.hours)}
                  className="w-full px-3 py-2 text-sm text-left text-text-muted hover:text-text-main hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors flex items-center justify-between"
                >
                  <span>Last {range.label}</span>
                  <span className="text-xs text-text-muted">
                    {range.hours === 24 ? "default" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <RequestLoggerV2 />
    </div>
  );
}
