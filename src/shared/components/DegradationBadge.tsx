"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

type DegradedFeature = { feature?: string; level?: string; reason?: string; capability?: string };

/**
 * Header badge shown while any feature runs in a degraded mode.
 *
 * It used to link to /dashboard/health, a page this build does not have (404), so the
 * details are shown in the tooltip instead.
 */
export default function DegradationBadge() {
  const [isDegraded, setDegraded] = useState(false);
  const [details, setDetails] = useState("");
  const t = useTranslations("common");

  useEffect(() => {
    const checkDegradation = async () => {
      try {
        const res = await fetch("/api/health/degradation");
        if (res.ok) {
          const data = await res.json();
          const features: DegradedFeature[] = Array.isArray(data?.features) ? data.features : [];
          setDegraded(data?.active === true || data?.isDegraded === true);
          setDetails(
            features
              .filter((f) => f && f.level && f.level !== "full")
              .map((f) => {
                const why = f.reason || f.capability;
                return `${f.feature || "feature"}: ${f.level}${why ? ` (${why})` : ""}`;
              })
              .join("\n")
          );
        }
      } catch (err) {
        // Ignore error
      }
    };

    checkDegradation();
    const interval = setInterval(checkDegradation, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!isDegraded) return null;

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-500 border border-amber-500/20 cursor-help"
      title={details || t("warning")}
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        healing
      </span>
      <span className="text-xs font-semibold whitespace-nowrap">Degraded</span>
    </span>
  );
}
