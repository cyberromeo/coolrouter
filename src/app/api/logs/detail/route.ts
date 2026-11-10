/**
 * GET  /api/logs/detail  — List legacy detailed request logs + current enabled flag
 * POST /api/logs/detail — Enable/disable pipeline capture for unified call log artifacts
 */
import { NextRequest, NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  getRequestDetailLogs,
  getRequestDetailLogCount,
  isDetailedLoggingEnabled,
} from "@/lib/db/detailedLogs";
import { updateSettings } from "@/lib/db/settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authError = await requireManagementAuth(req);
  if (authError) return authError;

  const url = new URL(req.url);
  // Non-numeric values would reach SQLite as NaN ("datatype mismatch" -> bare 500)
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  const logs = getRequestDetailLogs(limit, offset);
  const total = getRequestDetailLogCount();
  const enabled = await isDetailedLoggingEnabled();

  return NextResponse.json({ enabled, total, logs });
}

export async function POST(req: NextRequest) {
  const authError = await requireManagementAuth(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const rawEnabled = (body as Record<string, unknown>).enabled;
  const enabled = rawEnabled === true || rawEnabled === "1";

  await updateSettings({ call_log_pipeline_enabled: enabled });

  return NextResponse.json({
    success: true,
    enabled,
    message: enabled
      ? "Pipeline capture enabled. New request artifacts will include per-stage payloads."
      : "Pipeline capture disabled.",
  });
}
