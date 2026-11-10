"use client";

/**
 * Notification Store — FASE-07 UX & Microinteractions
 *
 * Zustand-based global notification system for the dashboard.
 * Replaces ad-hoc feedback patterns with a centralized toast system.
 *
 * @module store/notificationStore
 */

import { create } from "zustand";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";

let idCounter = 0;

/**
 * Toasts render `message` as a React child. Callers often pass an API payload's `error`
 * straight through, and that can be an object ({ message, details } from validation,
 * { code, message } from the auth gate) — rendering it crashes the whole dashboard.
 * Always store a string.
 */
function toMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.message;
  if (message === null || message === undefined) return "";
  if (typeof message === "object") return getApiErrorMessage({ error: message });
  return String(message);
}

type NotificationType = "success" | "error" | "warning" | "info";

interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  title?: string | null;
  duration: number;
  dismissible: boolean;
  createdAt: number;
}

interface NotificationStore {
  notifications: Notification[];
  addNotification: (notification: {
    type?: NotificationType;
    message: string;
    title?: string;
    duration?: number;
    dismissible?: boolean;
  }) => number;
  removeNotification: (id: number) => void;
  clearAll: () => void;
  success: (message: string, title?: string) => number;
  error: (message: string, title?: string) => number;
  warning: (message: string, title?: string) => number;
  info: (message: string, title?: string) => number;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = ++idCounter;
    const entry: Notification = {
      id,
      type: notification.type || "info",
      message: toMessageText(notification.message),
      title: notification.title || null,
      duration: notification.duration ?? 5000,
      dismissible: notification.dismissible ?? true,
      createdAt: Date.now(),
    };

    set((s) => ({
      notifications: [...s.notifications, entry],
    }));

    // Auto-dismiss
    if (entry.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, entry.duration);
    }

    return id;
  },

  removeNotification: (id) => {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => set({ notifications: [] }),

  // ─── Convenience Methods ─────────────────

  success: (message, title) => get().addNotification({ type: "success", message, title }),

  error: (message, title) =>
    get().addNotification({ type: "error", message, title, duration: 8000 }),

  warning: (message, title) => get().addNotification({ type: "warning", message, title }),

  info: (message, title) => get().addNotification({ type: "info", message, title }),
}));
