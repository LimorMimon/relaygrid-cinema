import { getPartnerMcpClient } from "@/lib/partner-mcp";

export const runtime = "nodejs";

/**
 * Ordinary nodejs-runtime API route whose only job is to trigger
 * PartnerMcpClient's lazy connection (lib/partner-mcp.ts) — called by
 * instrumentation.ts at server boot via a plain fetch(), specifically so
 * that file never has to import lib/partner-mcp.ts (and transitively
 * @modelcontextprotocol/sdk's stdio transport / child_process) directly.
 * Next.js compiles instrumentation.ts for both the nodejs and edge
 * runtimes even though its register() only ever runs the nodejs branch,
 * and that edge compilation pass fails outright on a child_process import
 * — confirmed live. A real API route with `runtime = "nodejs"` doesn't
 * have that problem (see app/api/agent and app/api/sponsor-ingest, which
 * already import lib/partner-mcp.ts directly without issue), so routing
 * the warm-up through one sidesteps the edge-bundling failure entirely.
 */
export async function GET() {
  try {
    const tools = await getPartnerMcpClient().listTools();
    return Response.json({ warmed: true, toolCount: tools.length });
  } catch (error) {
    return Response.json({ warmed: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
