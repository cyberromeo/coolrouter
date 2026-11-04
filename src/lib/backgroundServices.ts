import { startModelSyncScheduler } from "@/shared/services/modelSyncScheduler";
import "@/lib/tokenHealthCheck"; // Proactive token health-check scheduler

// Starts background services (model auto-sync, token health checks) once per process.
let initialized = false;

function isBackgroundServicesDisabled(): boolean {
  const raw = process.env.COOLROUTER_DISABLE_BACKGROUND_SERVICES;
  if (!raw) return false;
  return new Set(["1", "true", "yes", "on"]).has(raw.trim().toLowerCase());
}

export function ensureBackgroundServices() {
  if (isBackgroundServicesDisabled()) return false;
  if (!initialized) {
    try {
      startModelSyncScheduler();
      initialized = true;
    } catch (error) {
      console.error("[ServerInit] Error starting background services:", error);
    }
  }
  return initialized;
}

ensureBackgroundServices();

export default ensureBackgroundServices;
