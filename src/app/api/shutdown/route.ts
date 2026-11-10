import { NextResponse } from "next/server";
import { requestProcessShutdown } from "@/lib/gracefulShutdown";

export async function POST() {
  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    requestProcessShutdown();
  }, 500);

  return response;
}
