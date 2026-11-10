import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

// GET /api/providers/client - List all connections for the dashboard client
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Never ship credentials to the browser. This used to return the decrypted apiKey and
    // OAuth tokens of every connection "for cloud sync", but cloud sync reads the DB on the
    // server; the only caller is the Playground, which needs id / name / provider / authType.
    const clientConnections = connections.map((c) => ({
      ...c,
      apiKey: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      idToken: undefined,
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
