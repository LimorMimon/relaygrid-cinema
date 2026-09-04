import { getPartnerMcpClient } from "@/lib/partner-mcp";
import type { SponsorEvent } from "@/lib/sponsor-event-bus";

export const runtime = "nodejs";

/**
 * Server-side landing point for every event published on the sponsor event
 * bus (see lib/sponsor-event-bus.ts) — the browser fires one of these,
 * fire-and-forget, right alongside every publishSponsorEvent call in
 * hooks/use-grid-agent.ts. The local event bus already gives the
 * Integrations tab its instant, no-network UI (see
 * components/sponsor-integrations.tsx); this route is the background path
 * that additionally forwards the same event into whichever partner is
 * actually configured (PARTNER_MCP), via PartnerMcpClient.ingestEvent —
 * currently ClickHouse (a real row in the `policy_events` table), a no-op
 * when no partner is configured. Adding Grafana/Replit later means
 * implementing ingestEvent on their own client; this route never changes.
 *
 * Deliberately fire-and-forget from the browser's side: ingestion latency
 * or a transient partner outage must never block the live grid UI.
 */
export async function POST(request: Request) {
  let event: SponsorEvent;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    await getPartnerMcpClient().ingestEvent(event);
    return Response.json({ ingested: true });
  } catch (error) {
    // Non-fatal by design — the browser doesn't await this call's result,
    // but still return a real status so it's visible in server logs / devtools.
    return Response.json({ ingested: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
