import { getPartnerMcpClients } from "@/lib/partner-mcp";

export const runtime = "nodejs";

/**
 * Tells the browser which partner MCP integrations are actually configured
 * right now (see lib/partner-mcp.ts) — driven purely by the server's own
 * PARTNER_MCP env var (which may name more than one partner at once), never
 * by anything the client claims. Exists so GrafanaTab
 * (components/sponsor-integrations.tsx) can show "Live" vs. "Simulated"
 * truthfully instead of a hardcoded label that could silently drift from
 * reality, the same reasoning as app/api/agent-backend-info/route.ts.
 * Cheap to call: a client's .id never triggers its lazy subprocess
 * connection, only listTools/callTool/ingestEvent do that.
 */
export async function GET() {
  return Response.json({ ids: getPartnerMcpClients().map((client) => client.id) });
}
