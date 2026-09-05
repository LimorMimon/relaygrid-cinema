import { getPartnerMcpClients } from "@/lib/partner-mcp";
import type { SponsorEvent } from "@/lib/sponsor-event-bus";

export const runtime = "nodejs";

/**
 * Server-side landing point for every event published on the sponsor event
 * bus (see lib/sponsor-event-bus.ts) — the browser fires one of these,
 * fire-and-forget, right alongside every publishSponsorEvent call in
 * hooks/use-grid-agent.ts. The local event bus already gives the
 * Integrations tab its instant, no-network UI (see
 * components/sponsor-integrations.tsx); this route is the background path
 * that additionally forwards the same event into every partner actually
 * configured (PARTNER_MCP may name more than one — see
 * lib/partner-mcp.ts's getPartnerMcpClients), via each client's own
 * PartnerMcpClient.ingestEvent — currently a real row in ClickHouse's
 * `policy_events` table and/or a real Loki push for Grafana, nothing at all
 * when no partner is configured.
 *
 * Deliberately fire-and-forget from the browser's side: ingestion latency
 * or a transient partner outage must never block the live grid UI. One
 * partner failing must also never stop the others from receiving the same
 * event, so every client is given its own try/catch instead of one for the
 * whole route — a broken ClickHouse connection can't take Grafana down with
 * it, or vice versa.
 */
export async function POST(request: Request) {
  let event: SponsorEvent;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const results = await Promise.all(
    getPartnerMcpClients().map(async (client) => {
      try {
        await client.ingestEvent(event);
        return { partner: client.id, ingested: true as const };
      } catch (error) {
        // Non-fatal by design — the browser doesn't await this call's
        // result, and this partner's failure must not affect any other's.
        // Still logged server-side so a broken integration is visible
        // somewhere, even though nothing surfaces it to the UI.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[sponsor-ingest] ${client.id} ingestEvent failed:`, message);
        return { partner: client.id, ingested: false as const, error: message };
      }
    }),
  );
  return Response.json({ results });
}
