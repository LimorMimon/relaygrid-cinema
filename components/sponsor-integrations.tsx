"use client";
/**
 * "Integrations" tab: a sponsor-facing surface built from the exact same
 * event stream that already drives the audit trail and the agent-chat
 * narration (see lib/sponsor-event-bus.ts and hooks/use-grid-agent.ts's
 * publishSponsorEvent calls). Each tab renders that stream in its
 * partner's own shape — but they're not all the same underneath:
 *   - ClickHouse is REAL: every event is also written, via
 *     ingestSponsorEventRemote -> app/api/sponsor-ingest/route.ts ->
 *     lib/partner-mcp.ts, into an actual ClickHouse Cloud table through the
 *     official mcp-clickhouse MCP server. LiveBadge says so.
 *   - Grafana and Replit are still SIMULATIONS — no network call, no
 *     credentials for either exist yet — so they keep the "simulated"
 *     badge, the same honesty the grid's own MCP Action Preview card
 *     already practices ("no changes made" until a human approves).
 */
import { Fragment, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Database, Gauge, Info, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSponsorEvents } from "@/hooks/use-sponsor-events";
import type { SponsorEvent } from "@/lib/sponsor-event-bus";

const APP_START = Date.now();

function formatClock(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** Time-only, no date — the ClickHouse table's Time column is a few dozen pixels wide, so the full timestamp (visible in the expanded payload) doesn't fit. */
function formatTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 19);
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

function EmptyState({ label }: { label: string }) {
  return <p className="px-3 py-8 text-center text-[11px] leading-4 text-ink-faint">No {label} yet — trigger an action or add a policy rule to see one here.</p>;
}

/** Renders the live event stream as Grafana/Loki-style structured log lines, newest first. */
function GrafanaTab({ events }: { events: SponsorEvent[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col items-start gap-1.5">
        <SimulatedBadge />
        <p className="text-[11px] leading-4 text-ink-dim">
          What would be pushed to <span className="font-display text-ink">loki.grafana.net/loki/api/v1/push</span> as each action fires.
        </p>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded border border-line-bright bg-void-2">
        {events.length === 0 ? (
          <EmptyState label="log lines" />
        ) : (
          <div className="divide-y divide-line/70 font-display text-[10.5px] leading-5">
            {events.map((e) => {
              const level = e.kind === "action_executed" ? "info" : "notice";
              return (
                <div key={e.id} className="px-3 py-1.5">
                  <span className="text-ink-faint">{formatClock(new Date(e.timestamp))}</span>{" "}
                  <span className={level === "info" ? "text-signal" : "text-auto"}>level={level}</span>{" "}
                  <span className="text-ink-dim">source={e.source}</span>{" "}
                  <span className="text-ink-dim">kind={e.kind}</span>{" "}
                  <span className="text-ink">msg=&quot;{e.summary}&quot;</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
            <thead className="sticky top-0 z-10 bg-panel-2 font-display text-[9px] font-bold uppercase tracking-wider text-ink-faint">
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
                      <td className="truncate px-1.5 py-1.5 tabular-nums text-ink-faint" title={formatClock(new Date(e.timestamp))}>
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

/** A simulated hosting-status panel: uptime ticks live, resources nudge every few seconds, and the "last event" line reads off the same event bus as the other two tabs. */
function ReplitTab({ events }: { events: SponsorEvent[] }) {
  const [uptimeMs, setUptimeMs] = useState(() => Date.now() - APP_START);
  const [resources, setResources] = useState({ cpu: 6, memoryMb: 128 });

  useEffect(() => {
    const tick = setInterval(() => setUptimeMs(Date.now() - APP_START), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    // Nudges toward "busier" right after an event, then settles — a light,
    // clearly-synthetic simulation of load, not a real resource reading.
    const base = { cpu: 6, memoryMb: 128 };
    const bump = Math.min(events.length, 20);
    setResources({ cpu: base.cpu + bump * 1.4, memoryMb: base.memoryMb + bump * 3 });
    const settle = setTimeout(() => setResources(base), 4000);
    return () => clearTimeout(settle);
  }, [events.length]);

  const lastEvent = events[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-start gap-1.5">
        <SimulatedBadge />
        <p className="text-[11px] leading-4 text-ink-dim">Hosting status for this Repl.</p>
      </div>
      <div className="rounded border border-line-bright bg-void-2 p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse-dot rounded-full bg-good" />
            <span className="font-display text-xs font-semibold text-ink">relaygrid-cinema</span>
          </div>
          <Badge className="border-good/40 bg-good-soft text-good">Running</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-display text-[11px]">
          <div>
            <dt className="text-ink-faint">Uptime</dt>
            <dd className="tabular-nums text-ink">{formatUptime(uptimeMs)}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Region</dt>
            <dd className="text-ink">us-east-1 (simulated)</dd>
          </div>
          <div>
            <dt className="text-ink-faint">CPU</dt>
            <dd className="tabular-nums text-ink">{resources.cpu.toFixed(1)}%</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Memory</dt>
            <dd className="tabular-nums text-ink">{resources.memoryMb.toFixed(0)} MB</dd>
          </div>
        </dl>
      </div>
      <div className="rounded border border-line-bright bg-void-2 p-3.5">
        <p className="mb-1.5 font-display text-[9px] font-bold uppercase tracking-wider text-ink-faint">Last agent event received</p>
        {lastEvent ? (
          <>
            <p className="text-xs leading-5 text-ink">{lastEvent.summary}</p>
            <p className="mt-0.5 font-display text-[10px] text-ink-faint">{formatClock(new Date(lastEvent.timestamp))}</p>
          </>
        ) : (
          <p className="text-[11px] leading-4 text-ink-faint">No events yet.</p>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: "grafana", label: "Grafana", fullLabel: "Grafana Observability", icon: Gauge },
  { id: "clickhouse", label: "ClickHouse", fullLabel: "ClickHouse Event Store", icon: Database },
  { id: "replit", label: "Replit", fullLabel: "Replit Hosting", icon: Server },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SponsorIntegrations() {
  const [tab, setTab] = useState<TabId>("grafana");
  const events = useSponsorEvents();

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="border-b border-line bg-panel-2 px-4 py-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Integrations &amp; Analytics</h3>
        <p className="mt-0.5 text-[11px] text-ink-dim">Every agent action, mirrored live into three sponsor-tech previews.</p>
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
        {tab === "grafana" ? <GrafanaTab events={events} /> : tab === "clickhouse" ? <ClickHouseTab events={events} /> : <ReplitTab events={events} />}
      </div>
    </section>
  );
}
