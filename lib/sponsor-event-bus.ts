/**
 * A tiny in-memory pub-sub bus that captures every agent-driven mutation —
 * a human-approved or autonomous action execution, or a newly-registered
 * policy rule — as one structured event.
 *
 * IMPORTANT: this is a SIMULATION. Nothing published here ever leaves the
 * browser — there is no network call, and this app holds no real Grafana
 * Cloud, ClickHouse, or Replit credentials. It exists purely so
 * components/sponsor-integrations.tsx can render, live, what a real
 * observability pipeline (a Grafana/Loki push, a ClickHouse insert, a
 * hosting status feed) WOULD look like if this demo were wired to one —
 * the same "preview, not real effect" spirit as the existing MCP Action
 * Preview card, just for the sponsor-integration surface instead of the
 * grid itself. Wiring in a real endpoint later only means adding a
 * `fetch`/client call inside `publishSponsorEvent` below; every call site
 * that produces events already stays the same.
 */

export type SponsorEventKind = "action_executed" | "policy_rule_added";

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

/** Records one event and fans it out to every subscribed tab. Call this at the same points an AuditEntry gets created — see hooks/use-grid-agent.ts. */
export function publishSponsorEvent(event: Omit<SponsorEvent, "id" | "timestamp">): void {
  const full: SponsorEvent = { ...event, id: `evt-${Date.now()}-${seq++}`, timestamp: Date.now() };
  history = [full, ...history].slice(0, MAX_HISTORY);
  listeners.forEach((listener) => listener(full));
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
