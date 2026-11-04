/**
 * GET  /api/system/version  — Current version and the latest GitHub release (cached ~6h)
 * POST /api/system/version  — Same, but forces a fresh check ("Check for updates" button)
 *
 * Source of truth: https://api.github.com/repos/cyberromeo/coolrouter/releases/latest
 * Opt out with COOLROUTER_DISABLE_UPDATE_CHECK=1. Offline installs fail silently
 * (latest = null, error set) instead of erroring.
 *
 * Security: requires dashboard authentication like other management routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { getUpdateStatus } from "@/lib/system/updateCheck";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getUpdateStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = await getUpdateStatus({ force: true });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
