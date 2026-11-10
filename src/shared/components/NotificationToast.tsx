"use client";

/**
 * NotificationToast — FASE-07 UX & Microinteractions
 *
 * Global toast notification component. Renders notifications from the
 * notificationStore as stacked toasts in the top-right corner.
 *
 * Usage: Add <NotificationToast /> to your root layout.
 */

import { useNotificationStore } from "@/store/notificationStore";
import { useEffect, useRef, useState } from "react";

const ICONS = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

const COLORS = {
  success: {
    bg: "rgba(16, 185, 129, 0.15)",
    border: "rgba(16, 185, 129, 0.4)",
    icon: "#10b981",
  },
  error: {
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.4)",
    icon: "#ef4444",
  },
  warning: {
    bg: "rgba(245, 158, 11, 0.15)",
    border: "rgba(245, 158, 11, 0.4)",
    icon: "#f59e0b",
  },
  info: {
    bg: "rgba(59, 130, 246, 0.15)",
    border: "rgba(59, 130, 246, 0.4)",
    icon: "#3b82f6",
  },
};

function Toast({ notification, count = 1, onDismiss }) {
  const [isExiting, setIsExiting] = useState(false);
  // Latest callback: a duplicate may join this toast while the exit animation runs.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismissRef.current();
      setIsExiting(false);
    }, 200);
  };

  const color = COLORS[notification.type] || COLORS.info;

  return (
    <div
      // Errors interrupt (alert); everything else is announced politely (status).
      role={notification.type === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "14px 16px",
        borderRadius: "10px",
        // Opaque theme surface with the type tint on top. The tint alone (15% alpha) over
        // the page, with the old fixed white/light-grey text, was unreadable in the light
        // theme: the text colours referenced CSS variables that do not exist.
        backgroundColor: "var(--color-surface, #0a0a0a)",
        backgroundImage: `linear-gradient(${color.bg}, ${color.bg})`,
        border: `1px solid ${color.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        // Same 320–420px as before, but never wider than a narrow phone screen (the
        // container sits 20px from the edge).
        minWidth: "min(320px, calc(100vw - 40px))",
        maxWidth: "min(420px, calc(100vw - 40px))",
        animation: isExiting ? "toastOut 0.2s ease-in forwards" : "toastIn 0.3s ease-out forwards",
        transition: "all 0.2s ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: "18px",
          color: color.icon,
          fontWeight: "bold",
          lineHeight: 1,
          marginTop: "2px",
        }}
      >
        {ICONS[notification.type]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {notification.title && (
          <div
            style={{
              fontWeight: 600,
              fontSize: "14px",
              color: "var(--color-text-main, #ededed)",
              marginBottom: "2px",
            }}
          >
            {notification.title}
          </div>
        )}
        <div
          style={{
            fontSize: "13px",
            color: "var(--color-text-main, #ededed)",
            lineHeight: 1.4,
            overflowWrap: "anywhere",
          }}
        >
          {notification.message}
          {count > 1 && <span style={{ opacity: 0.7 }}> (×{count})</span>}
        </div>
      </div>
      {notification.dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted, #a1a1a1)",
            fontSize: "16px",
            padding: "0 2px",
            lineHeight: 1,
            opacity: 0.6,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.6")}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function NotificationToast() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  // Identical notifications (a failing action clicked again, several rows failing with the
  // same error) share one toast instead of stacking a column of copies down the screen.
  const groups: { key: string; notification: (typeof notifications)[number]; ids: number[] }[] = [];
  const groupByKey = new Map<string, (typeof groups)[number]>();
  for (const n of notifications) {
    const key = `${n.type}\u0000${n.title || ""}\u0000${n.message}`;
    const existing = groupByKey.get(key);
    if (existing) {
      existing.ids.push(n.id);
    } else {
      const group = { key, notification: n, ids: [n.id] };
      groupByKey.set(key, group);
      groups.push(group);
    }
  }

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(100%) scale(0.95); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to   { opacity: 0; transform: translateX(100%) scale(0.95); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          pointerEvents: "none",
        }}
      >
        {groups.map((group) => (
          <div key={group.key} style={{ pointerEvents: "auto" }}>
            <Toast
              notification={group.notification}
              count={group.ids.length}
              onDismiss={() => group.ids.forEach((id) => removeNotification(id))}
            />
          </div>
        ))}
      </div>
    </>
  );
}
