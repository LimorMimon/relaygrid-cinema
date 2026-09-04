/**
 * A tiny in-memory pub-sub bus that captures every agent-driven mutation —
 * a human-approved or autonomous action execution, a newly-registered
 * policy rule, or a demo incident being injected — as one structured event.
 *
 * Two independent things happen with each event, on purpose:
 *   1. `publishSponsorEvent` fans it out to every browser-side subscriber
 *      (components/sponsor-integrations.tsx via hooks/use-sponsor-events.ts)
 *      — instant, no network, this is what makes the Integrations tab feel
 *      live even before anything reaches a real partner service.
 *   2. `ingestSponsorEventRemote` separately, fire-and-forget, posts the
 *      same event to app/api/sponsor-ingest/route.ts, which forwards it
 *      into whichever partner is actually configured (PARTNER_MCP) via
 *      lib/partner-mcp.ts's PartnerMcpClient.ingestEvent — a real row in
 *      ClickHouse today, a no-op when no partner is configured, and a
 *      clean seam for Grafana/Replit ingestion later without touching this
 *      file or its call sites again.
 * Callers (hooks/use-grid-agent.ts) always do both: `ingestSponsorEventRemote(publishSponsorEvent(...))`.
 */

export type SponsorEventKind = "action_executed" | "policy_rule_added" | "incident_injected";

export type SponsorEvent = {
  id: string;
  timestamp: number;
  kind: SponsorEventKind;
  /** Short human summary, e.g. "Restart Audio Encoder (policy #1) · 3 changed". */
  summary: string;
  /** Who/what caused this: a human clicking Approve, the autonomous policy loop, or a rule just being registered. */
  source: "human" | "policy" | "rule";
  /** The exact structured payload a real sink would receive — what each integration tab actually renders. */
  payload: Record<string, unknown>;
};

type Listener = (event: SponsorEvent) => void;

const MAX_HISTORY = 300;
let history: SponsorEvent[] = [];
const listeners = new Set<Listener>();
let seq = 0;

/** Records one event and fans it out to every subscribed tab. Call this at the same points an AuditEntry gets created — see hooks/use-grid-agent.ts. Returns the full event (with its assigned id/timestamp) so the caller can also forward it via ingestSponsorEventRemote. */
export function publishSponsorEvent(event: Omit<SponsorEvent, "id" | "timestamp">): SponsorEvent {
  const full: SponsorEvent = { ...event, id: `evt-${Date.now()}-${seq++}`, timestamp: Date.now() };
  history = [full, ...history].slice(0, MAX_HISTORY);
  listeners.forEach((listener) => listener(full));
  return full;
}

/**
 * Fire-and-forget: posts one event to the server-side ingestion route,
 * which pushes it into whichever partner is configured. Never awaited by
 * callers — a network hiccup or partner-side outage must never block the
 * UI, which already updated synchronously via publishSponsorEvent above.
 * Browser-only (uses fetch against a relative path); safe to call from any
 * "use client" code, never from a server module.
 */
export function ingestSponsorEventRemote(event: SponsorEvent): void {
  fetch("/api/sponsor-ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {
    // Best-effort. Failures are visible in server logs (app/api/sponsor-ingest/route.ts) and don't affect the local UI.
  });
}

/** The full event history so far, newest first — used to seed a subscriber that mounts after events already happened. */
export function getSponsorEventHistory(): SponsorEvent[] {
  return history;
}

/** Subscribes to every future event; returns an unsubscribe function. */
export function subscribeSponsorEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
