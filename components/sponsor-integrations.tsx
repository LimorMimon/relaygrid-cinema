"use client";
/**
 * "Integrations" tab: a sponsor-facing surface showing what this app WOULD
 * send to three external services, rendered from the exact same event
 * stream that already drives the audit trail and the agent-chat narration
 * (see lib/sponsor-event-bus.ts and hooks/use-grid-agent.ts's
 * publishSponsorEvent calls). Every tab below is a SIMULATION — no network
 * call is made, and this app holds no Grafana/ClickHouse/Replit
 * credentials — so every panel carries an explicit "simulated" badge,
 * matching the same honesty the grid's own MCP Action Preview card already
 * practices ("no changes made" until a human approves).
 */
import { useEffect, useState } from "react";
import { Database, Gauge, Info, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSponsorEvents } from "@/hooks/use-sponsor-events";
import type { SponsorEvent } from "@/lib/sponsor-event-bus";

const APP_START = Date.now();

function formatClock(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
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

/** Renders the live event stream as a ClickHouse-style query result — one JSON row per event. */
function ClickHouseTab({ events }: { events: SponsorEvent[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col items-start gap-1.5">
        <SimulatedBadge />
        <p className="text-[11px] leading-4 text-ink-dim">
          <span className="font-display text-ink">SELECT * FROM policy_events ORDER BY timestamp DESC LIMIT 50</span>
        </p>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded border border-line-bright bg-void-2">
        {events.length === 0 ? (
          <EmptyState label="event records" />
        ) : (
          <div className="divide-y divide-line/70">
            {events.map((e) => (
              <div key={e.id} className="px-3 py-2">
                <div className="mb-1 flex items-center gap-2 font-display text-[10px] uppercase tracking-wide text-ink-faint">
                  <span>{formatClock(new Date(e.timestamp))}</span>
                  <span className="rounded border border-line-bright bg-panel-2 px-1.5 py-0.5 text-signal">{e.kind}</span>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-display text-[10.5px] leading-5 text-ink-dim">
                  {JSON.stringify({ id: e.id, timestamp: e.timestamp, kind: e.kind, source: e.source, ...e.payload }, null, 2)}
                </pre>
              </div>
            ))}
          </div>
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
