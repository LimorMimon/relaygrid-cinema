/**
 * NOT YET IMPLEMENTED — seam for the hackathon's required Partner Track
 * integration (Grafana Labs or Replit, per current plan).
 *
 * The intent: a partner MCP server exposes its own tools (e.g. Grafana
 * dashboards/alerts/metrics queries for the streaming CDNs this grid
 * tracks). Once a client is implemented here, it plugs in at exactly one
 * point — `lib/mcp-tools.ts` builds this domain's own tool list; a partner
 * client's `listTools()` result would be concatenated onto that list before
 * it's sent to the agent backend, and a functionCall for one of its tool
 * names would be dispatched through `callTool()` instead of the local
 * grid dispatcher. Nothing else in the app needs to know a partner is
 * involved.
 *
 * Config this will need once implemented: e.g. GRAFANA_MCP_URL +
 * GRAFANA_SERVICE_ACCOUNT_TOKEN (Grafana), or REPLIT_MCP_URL + a Replit API
 * token (Replit) — selected via PARTNER_MCP.
 */

export type PartnerMcpTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export interface PartnerMcpClient {
  /** Selector value for PARTNER_MCP, e.g. "grafana" | "replit" | "none". */
  id: string;
  listTools(): Promise<PartnerMcpTool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

class NoPartnerMcpClient implements PartnerMcpClient {
  id = "none";
  async listTools(): Promise<PartnerMcpTool[]> {
    return [];
  }
  async callTool(): Promise<unknown> {
    throw new Error("No partner MCP server is configured (PARTNER_MCP is unset).");
  }
}

/** Selects the partner MCP client from PARTNER_MCP. Defaults to none. */
export function getPartnerMcpClient(): PartnerMcpClient {
  const id = process.env.PARTNER_MCP;
  if (!id || id === "none") return new NoPartnerMcpClient();
  throw new Error(`Partner MCP integration "${id}" is not implemented yet. Leave PARTNER_MCP unset to run without one.`);
}
