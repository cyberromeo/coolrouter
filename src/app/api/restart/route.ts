import { NextResponse } from "next/server";
import { requestProcessShutdown } from "@/lib/gracefulShutdown";

export async function POST() {
  // Graceful restart: SIGTERM flows through the shutdown handler before the process manager restarts
  setTimeout(() => {
    requestProcessShutdown();
  }, 500);

  return NextResponse.json({ status: "restarting" });
}
