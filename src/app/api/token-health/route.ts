/**
 * Token Health API Route — Batch G
 *
 * Exposes aggregate health status of OAuth tokens.
 * Used by TokenHealthBadge in the Header.
 */

import { getProviderConnections } from "@/lib/localDb";

export async function GET() {
  try {
    const connections = await getProviderConnections({ authType: "oauth" });
    const oauthConns = (connections || []).filter((c) => c.isActive && c.refreshToken);

    const total = oauthConns.length;
    const isErrored = (c) => c.testStatus === "error" || c.lastErrorType === "token_refresh_failed";
    const errored = oauthConns.filter(isErrored).length;
    // Mutually exclusive buckets: a connection that is both "active" and failing its
    // refresh used to land in both, which made `warning` negative.
    const healthy = oauthConns.filter(
      (c) => !isErrored(c) && (c.testStatus === "active" || !c.lastError)
    ).length;
    const lastCheck = oauthConns.reduce((latest, c) => {
      if (!c.lastHealthCheckAt) return latest;
      return latest && latest > c.lastHealthCheckAt ? latest : c.lastHealthCheckAt;
    }, null);

    return Response.json({
      total,
      healthy,
      errored,
      warning: total - healthy - errored,
      lastCheckAt: lastCheck,
      status: errored > 0 ? "error" : healthy < total ? "warning" : "healthy",
    });
  } catch (err) {
    return Response.json({ error: err.message, status: "unknown" }, { status: 500 });
  }
}
