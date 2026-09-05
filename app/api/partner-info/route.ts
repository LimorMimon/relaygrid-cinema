import { getPartnerMcpClient } from "@/lib/partner-mcp";

export const runtime = "nodejs";

/**
 * Tells the browser which partner MCP integration is actually configured
 * right now (see lib/partner-mcp.ts) — driven purely by the server's own
 * PARTNER_MCP env var, never by anything the client claims. Exists so
 * GrafanaTab (components/sponsor-integrations.tsx) can show "Live" vs.
 * "Simulated" truthfully instead of a hardcoded label that could silently
 * drift from reality, the same reasoning as app/api/agent-backend-info/route.ts.
 * Cheap to call: getPartnerMcpClient().id never triggers the lazy subprocess
 * connection, only listTools/callTool/ingestEvent do that.
 */
export async function GET() {
  return Response.json({ id: getPartnerMcpClient().id });
}
