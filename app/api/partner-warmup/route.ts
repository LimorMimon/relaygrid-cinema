import { getPartnerMcpClients } from "@/lib/partner-mcp";

export const runtime = "nodejs";

/**
 * Ordinary nodejs-runtime API route whose only job is to trigger every
 * configured PartnerMcpClient's lazy connection (lib/partner-mcp.ts,
 * PARTNER_MCP may name more than one) — called by instrumentation.ts at
 * server boot via a plain fetch(), specifically so that file never has to
 * import lib/partner-mcp.ts (and transitively
 * @modelcontextprotocol/sdk's stdio transport / child_process) directly.
 * Next.js compiles instrumentation.ts for both the nodejs and edge
 * runtimes even though its register() only ever runs the nodejs branch,
 * and that edge compilation pass fails outright on a child_process import
 * — confirmed live. A real API route with `runtime = "nodejs"` doesn't
 * have that problem (see app/api/agent and app/api/sponsor-ingest, which
 * already import lib/partner-mcp.ts directly without issue), so routing
 * the warm-up through one sidesteps the edge-bundling failure entirely.
 *
 * Each partner warms up independently — one failing to connect (bad
 * credentials, subprocess crash) never stops the others from warming, and
 * never fails this route; it just gets its own error entry instead of a
 * toolCount.
 */
export async function GET() {
  const results = await Promise.all(
    getPartnerMcpClients().map(async (client) => {
      try {
        const tools = await client.listTools();
        return { partner: client.id, warmed: true as const, toolCount: tools.length };
      } catch (error) {
        return { partner: client.id, warmed: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return Response.json({ results });
}
