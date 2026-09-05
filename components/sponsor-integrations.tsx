"use client";
/**
 * "Integrations" tab: a sponsor-facing surface built from the exact same
 * event stream that already drives the audit trail and the agent-chat
 * narration (see lib/sponsor-event-bus.ts and hooks/use-grid-agent.ts's
 * publishSponsorEvent calls). Each tab renders that stream in its
 * partner's own shape — but they're not the same underneath:
 *   - ClickHouse is REAL: every event is also written, via
 *     ingestSponsorEventRemote -> app/api/sponsor-ingest/route.ts ->
 *     lib/partner-mcp.ts, into an actual ClickHouse Cloud table through the
 *     official mcp-clickhouse MCP server. LiveBadge says so.
 *   - Grafana is real whenever PARTNER_MCP includes "grafana" (it can name
 *     more than one partner at once, e.g. "clickhouse,grafana" — see
 *     lib/partner-mcp.ts's getPartnerMcpClients) — same
 *     ingestSponsorEventRemote path, into a real Loki stream via
 *     GrafanaPartnerMcpClient. GrafanaTab asks
 *     app/api/partner-info/route.ts which partners are truly active and
 *     only then swaps its badge from "Simulated" to "Live", the same
 *     honesty the grid's own MCP Action Preview card already practices
 *     ("no changes made" until a human approves). When Grafana isn't one
 *     of the active partners, this tab correctly falls back to "Simulated"
 *     regardless of what else is configured.
 * (A third, Replit hosting-status preview lived here too; removed as pure
 * scope reduction — its usefulness was always more limited than the other
 * two, since it modeled Replit as a *deployment target* for this app rather
 * than a sponsor-tech partner reacting to grid events the way Grafana/
 * ClickHouse do.)
 */
import { Fragment, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Database, Gauge, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSponsorEvents } from "@/hooks/use-sponsor-events";
import type { SponsorEvent } from "@/lib/sponsor-event-bus";

function formatClock(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** Time-only, no date — the ClickHouse table's Time column is a few dozen pixels wide, so the full timestamp (visible in the expanded payload) doesn't fit. */
function formatTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 19);
}

function SimulatedBadge() {
  return (
    <Badge className="border-caution/40 bg-caution-soft text-caution" title="Rendered entirely from local app state — no network call is made and no real credentials exist for this service.">
      <Info className="size-3" /> Simulated — nothing leaves this browser
    </Badge>
  );
}

function LiveBadge() {
  return (
    <Badge
      className="border-good/40 bg-good-soft text-good"
      title="Every event is also sent to app/api/sponsor-ingest, which writes it into a real ClickHouse Cloud table via the official mcp-clickhouse MCP server."
    >
      <CheckCircle2 className="size-3" /> Live — written to real ClickHouse Cloud
    </Badge>
  );
}

/** Grafana's own live badge — deliberately separate from LiveBadge above (ClickHouse's) rather than a shared/parameterized component, so editing this one can never touch what the ClickHouse tab renders. */
function GrafanaLiveBadge() {
  return (
    <Badge
      className="border-good/40 bg-good-soft text-good"
      title="Every event is also sent to app/api/sponsor-ingest, which pushes it into a real Grafana Cloud Loki stream (and exposes the official mcp-grafana MCP server's tools) via lib/partner-mcp.ts's GrafanaPartnerMcpClient."
    >
      <CheckCircle2 className="size-3" /> Live — written to real Grafana Cloud
    </Badge>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="px-3 py-8 text-center text-[11px] leading-4 text-ink-faint">No {label} yet — trigger an action or add a policy rule to see one here.</p>;
}

/** Real Loki levels only, unlike the old placeholder "notice": a routine action or rule registration is "info", a freshly-injected incident starts life as "warn" — nothing here reaches "error", since RelayGrid's whole premise is resolving things before they'd escalate that far. */
function grafanaLevel(kind: SponsorEvent["kind"]): "info" | "warn" {
  return kind === "incident_injected" ? "warn" : "info";
}

/**
 * Renders the live event stream as an actual Grafana Explore "Logs" table
 * view — Time / Level / Kind / Source / Message columns, newest first,
 * mirroring the ClickHouse tab's real query-result table (same row/expand
 * mechanics, same column-header shape) rather than raw Loki log-line text.
 * Clicking a row still opens the "Detected fields" breakdown Grafana shows
 * under a selected log line — that part stays Grafana's own vocabulary,
 * built from the same payload object ClickHouse's JSON view uses.
 */
function GrafanaTab({ events, live }: { events: SponsorEvent[]; live: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col items-start gap-1.5">
        {live ? <GrafanaLiveBadge /> : <SimulatedBadge />}
        <p className="text-[11px] leading-4 text-ink-dim">
          {live ? "Rows below are also pushed to" : "What would be pushed to"} <span className="font-display text-ink">loki.grafana.net/loki/api/v1/push</span> as each action fires,
          queryable in Explore as <span className="font-display text-ink">{`{service="relaygrid"} | json`}</span>. Click a row to inspect its detected fields.
        </p>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded border border-line-bright bg-void-2">
        {events.length === 0 ? (
          <EmptyState label="log lines" />
        ) : (
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-4" />
              <col className="w-11" />
              <col className="w-9" />
              <col className="w-16" />
              <col className="w-11" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-panel-2 font-display text-[9px] font-bold uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-1.5 py-1.5" aria-hidden="true" />
                <th className="truncate px-1.5 py-1.5">Time</th>
                <th className="truncate px-1.5 py-1.5">Level</th>
                <th className="truncate px-1.5 py-1.5">Kind</th>
                <th className="truncate px-1.5 py-1.5">Source</th>
                <th className="truncate px-1.5 py-1.5">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {events.map((e) => {
                const level = grafanaLevel(e.kind);
                const isOpen = expandedId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpandedId(isOpen ? null : e.id)}
                      aria-expanded={isOpen}
                      className={`cursor-pointer font-display text-[10.5px] transition-colors ${isOpen ? "bg-panel-2/60" : "hover:bg-panel-2/40"}`}
                    >
                      <td className="px-1.5 py-1.5 text-ink-faint">
                        {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      </td>
                      <td className="truncate px-1.5 py-1.5 tabular-nums text-ink-dim" title={formatClock(new Date(e.timestamp))}>
                        {formatTimeOnly(new Date(e.timestamp))}
                      </td>
                      <td className="truncate px-1.5 py-1.5">
                        <span className={`rounded border border-line-bright bg-panel-2 px-1 py-0.5 ${level === "warn" ? "text-caution" : "text-signal"}`}>{level}</span>
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-ink-dim" title={e.kind}>
                        {e.kind}
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-ink-dim" title={e.source}>
                        {e.source}
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-ink" title={e.summary}>
                        {e.summary}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="bg-void px-3 py-2">
                          <p className="mb-1 font-display text-[9px] font-bold uppercase tracking-wider text-ink-faint">Detected fields</p>
                          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-display text-[10.5px] leading-5">
                            {Object.entries({ id: e.id, timestamp: new Date(e.timestamp).toISOString(), level, source: e.source, kind: e.kind, ...e.payload }).map(([key, value]) => (
                              <Fragment key={key}>
                                <dt className="text-ink-faint">{key}</dt>
                                <dd className="truncate text-ink-dim" title={typeof value === "object" ? JSON.stringify(value) : String(value)}>
                                  {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                </dd>
                              </Fragment>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[10px] text-ink-faint">{events.length.toLocaleString()} log line{events.length === 1 ? "" : "s"}</p>
    </div>
  );
}

/** The Kind column has only ~60px to work with — this project's event kinds spelled out ("action_executed") wouldn't leave room for Summary, so the badge shows a short label while `e.kind` itself (unabbreviated) stays in the tooltip and the expanded payload. */
function kindLabel(kind: SponsorEvent["kind"]): string {
  switch (kind) {
    case "action_executed":
      return "Action";
    case "policy_rule_added":
      return "Rule added";
    case "incident_injected":
      return "Incident";
  }
}

/**
 * Renders the live event stream as an actual ClickHouse-style query result
 * table — Time / Kind / Source / Summary columns, newest first — instead of
 * a raw JSON dump. Clicking a row expands it in place to show the full
 * payload that real table row actually carries (the same object ClickHouse
 * receives), so the tab reads as a query result you can drill into rather
 * than a debug log.
 */
function ClickHouseTab({ events }: { events: SponsorEvent[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col items-start gap-1.5">
        <LiveBadge />
        <p className="text-[11px] leading-4 text-ink-dim">
          Rows below are the local mirror for instant UI — the same events are pushed in the background into a real table, queryable as{" "}
          <span className="font-display text-ink">SELECT * FROM policy_events ORDER BY timestamp DESC LIMIT 50</span>. Click a row to inspect its full payload.
        </p>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded border border-line-bright bg-void-2">
        {events.length === 0 ? (
          <EmptyState label="event records" />
        ) : (
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-4" />
              <col className="w-11" />
              <col className="w-16" />
              <col className="w-11" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-panel-2 font-display text-[9px] font-bold uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-1.5 py-1.5" aria-hidden="true" />
                <th className="truncate px-1.5 py-1.5">Time</th>
                <th className="truncate px-1.5 py-1.5">Kind</th>
                <th className="truncate px-1.5 py-1.5">Source</th>
                <th className="truncate px-1.5 py-1.5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {events.map((e) => {
                const isOpen = expandedId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpandedId(isOpen ? null : e.id)}
                      aria-expanded={isOpen}
                      className={`cursor-pointer font-display text-[10.5px] transition-colors ${isOpen ? "bg-panel-2/60" : "hover:bg-panel-2/40"}`}
                    >
                      <td className="px-1.5 py-1.5 text-ink-faint">
                        {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      </td>
                      <td className="truncate px-1.5 py-1.5 tabular-nums text-ink-dim" title={formatClock(new Date(e.timestamp))}>
                        {formatTimeOnly(new Date(e.timestamp))}
                      </td>
                      <td className="truncate px-1.5 py-1.5" title={e.kind}>
                        <span className="rounded border border-line-bright bg-panel-2 px-1 py-0.5 text-signal">{kindLabel(e.kind)}</span>
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-ink-dim" title={e.source}>
                        {e.source}
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-ink" title={e.summary}>
                        {e.summary}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="bg-void px-3 py-2">
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-display text-[10.5px] leading-5 text-ink-dim">
                            {JSON.stringify({ id: e.id, timestamp: e.timestamp, kind: e.kind, source: e.source, ...e.payload }, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[10px] text-ink-faint">{events.length.toLocaleString()} row{events.length === 1 ? "" : "s"}</p>
    </div>
  );
}

const TABS = [
  { id: "grafana", label: "Grafana", fullLabel: "Grafana Observability", icon: Gauge },
  { id: "clickhouse", label: "ClickHouse", fullLabel: "ClickHouse Event Store", icon: Database },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SponsorIntegrations() {
  const [tab, setTab] = useState<TabId>("grafana");
  const events = useSponsorEvents();

  // Which partner MCP(s) the server is actually configured with (see
  // app/api/partner-info/route.ts — PARTNER_MCP may name more than one at
  // once) — truthfully reflects reality, so GrafanaTab's badge can't
  // silently claim "Live" or "Simulated" when it isn't actually true. Same
  // pattern as cinema-grid-app.tsx's agentBackendId.
  const [activePartnerIds, setActivePartnerIds] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/partner-info")
      .then((res) => res.json())
      .then((data: { ids?: string[] }) => setActivePartnerIds(data.ids ?? []))
      .catch(() => setActivePartnerIds([]));
  }, []);

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="border-b border-line bg-panel-2 px-4 py-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Integrations &amp; Analytics</h3>
        <p className="mt-0.5 text-[11px] text-ink-dim">Every agent action, mirrored live into two sponsor-tech previews.</p>
      </div>

      {/* Short labels on purpose — this column can be as narrow as 300px, and the full sponsor name (e.g. "ClickHouse Event Store") only needs to appear once, as each tab body's own heading below. */}
      <div className="flex flex-wrap gap-1 border-b border-line bg-panel-2/60 px-3 pt-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-t px-2.5 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              tab === id ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
            }`}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        <p className="mb-2 font-display text-[9px] font-bold uppercase tracking-wider text-ink-faint">{TABS.find((t) => t.id === tab)?.fullLabel}</p>
        {tab === "grafana" ? <GrafanaTab events={events} live={activePartnerIds.includes("grafana")} /> : <ClickHouseTab events={events} />}
      </div>
    </section>
  );
}
