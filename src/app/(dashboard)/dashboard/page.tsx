import path from "path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMachineId } from "@/shared/utils/machine";
import { getSettings } from "@/lib/localDb";
import { resolveDataDir } from "@/lib/dataPaths";
import HomePageClient from "./HomePageClient";
import BootstrapBanner from "./BootstrapBanner";

// Must be dynamic — depends on DB state (setupComplete) that changes at runtime
export const dynamic = "force-dynamic";

/** Where the auto-generated secrets live, with the home folder shortened to "~". */
function getServerEnvDisplayPath(): string | undefined {
  try {
    const envPath = path.join(resolveDataDir(), "server.env");
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    return homeDir && envPath.startsWith(homeDir) ? "~" + envPath.slice(homeDir.length) : envPath;
  } catch {
    return undefined;
  }
}

/**
 * Origin the browser used for this request, so the first HTML already shows the right
 * endpoint URL (custom port, LAN host, reverse proxy). The client replaces it with
 * window.location.origin after hydration, which stays the source of truth.
 */
async function getRequestOrigin(): Promise<string | undefined> {
  try {
    const requestHeaders = await headers();
    const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
    const host = first(requestHeaders.get("x-forwarded-host")) || first(requestHeaders.get("host"));
    if (!host) return undefined;
    const protocol = first(requestHeaders.get("x-forwarded-proto")) || "http";
    return `${protocol}://${host}`;
  } catch {
    return undefined;
  }
}

export default async function DashboardPage() {
  const settings = await getSettings();
  if (!settings.setupComplete) {
    redirect("/dashboard/onboarding");
  }
  const machineId = await getMachineId();
  const isBootstrapped = process.env.COOLROUTER_BOOTSTRAPPED === "true";
  return (
    <>
      {isBootstrapped && <BootstrapBanner envFilePath={getServerEnvDisplayPath()} />}
      <HomePageClient machineId={machineId} initialOrigin={await getRequestOrigin()} />
    </>
  );
}
