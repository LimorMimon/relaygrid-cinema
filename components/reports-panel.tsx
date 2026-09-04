"use client";
/**
 * Read-only "Saved Reports" tab. Reports are created only by the
 * generate_analytics_report MCP tool (via chat) — this component never
 * calls it itself, it just renders the `reports`/`savedReportSpecs` state
 * the hook already produced.
 */
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ReportResult, ReportSpec } from "@/lib/grid-engine";

/** Horizontal single-hue bar list — rows are already sorted descending, so the biggest bucket reads first at a glance. */
function ReportBars({ result }: { result: ReportResult }) {
  const max = result.rows[0]?.value ?? 0;
  return (
    <div className="space-y-2.5">
      {result.rows.map((row) => (
        <div key={row.group}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-ink">{row.group}</span>
            <span className="shrink-0 font-display tabular-nums text-ink-dim">{row.value}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-void-2">
            <div
              className="h-full rounded-full bg-signal transition-[width]"
              style={{ width: `${max > 0 ? Math.max((row.value / max) * 100, 4) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReportsPanel({
  reports,
  savedReportSpecs,
}: {
  reports: ReportResult[];
  savedReportSpecs: ReportSpec[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Follow the newest report as it arrives, but don't yank the judge's focus
  // away from a saved report they deliberately clicked into.
  useEffect(() => {
    setSelectedId((current) => {
      if (current && reports.some((r) => r.spec.id === current)) return current;
      return reports[0]?.spec.id ?? null;
    });
  }, [reports]);

  const selected = reports.find((r) => r.spec.id === selectedId) ?? reports[0] ?? null;

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 size-4 shrink-0 text-signal" />
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Analytics Reports</h3>
            <p className="mt-0.5 text-[11px] text-ink-dim">Ask the copilot for a breakdown — it renders here.</p>
          </div>
        </div>
        {savedReportSpecs.length > 0 && (
          <Badge className="shrink-0 border-signal/40 bg-signal-soft text-signal">{savedReportSpecs.length} saved</Badge>
        )}
      </div>

      {!selected ? (
        <div className="px-4 py-8 text-center">
          <BarChart3 className="mx-auto mb-2 size-5 text-ink-faint" />
          <p className="text-xs font-medium text-ink-dim">No reports yet</p>
          <p className="mx-auto mt-1 max-w-[22ch] text-[11px] leading-4 text-ink-faint">
            Try “Show audio issues by CDN provider over the last 24 hours.”
          </p>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate font-display text-sm font-semibold text-ink">{selected.spec.title}</p>
            <Badge className="shrink-0 border-line-bright bg-void-2 text-ink-dim">{selected.spec.timeWindow}</Badge>
          </div>
          <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">{selected.total}</p>
          <p className="-mt-0.5 text-[11px] text-ink-faint">matching · grouped by {selected.spec.groupBy}</p>

          {selected.rows.length > 0 ? (
            <div className="mt-3">
              <ReportBars result={selected} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-faint">Nothing matched this filter in the selected window.</p>
          )}

          <p className="mt-3 text-[10px] text-ink-faint">
            Generated {new Date(selected.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      )}

      {savedReportSpecs.length > 0 && (
        <div className="border-t border-line">
          <p className="px-4 pt-2.5 pb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Saved</p>
          <ul className="divide-y divide-line">
            {savedReportSpecs.map((spec) => {
              const hasResult = reports.some((r) => r.spec.id === spec.id);
              const active = spec.id === selected?.spec.id;
              return (
                <li key={spec.id}>
                  <button
                    type="button"
                    disabled={!hasResult}
                    onClick={() => setSelectedId(spec.id)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? "border-l-2 border-signal bg-signal-soft/40" : "border-l-2 border-transparent hover:bg-panel-2"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display text-xs font-medium text-ink">{spec.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-ink-faint">
                        {spec.metric} by {spec.groupBy}
                      </p>
                    </div>
                    <Badge className="shrink-0 border-line-bright bg-void-2 text-ink-dim">{spec.timeWindow}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
