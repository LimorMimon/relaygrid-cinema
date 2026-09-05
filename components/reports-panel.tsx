"use client";
/**
 * "Reports" tab: Saved sub-tab (compose-a-report input + the most recent
 * result + the saved-report list) and Suggested sub-tab (candidate reports
 * computed from real current data, each addable with one click) — the same
 * shape as PolicyRulesPanel's Active/Suggested split, so the two "ask in
 * plain English, or pick a computed suggestion" flows in this app read as
 * one consistent pattern instead of two different ones.
 *
 * Reports are read-only and side-effect-free (unlike a policy rule, nothing
 * about a report changes standing automation), so there's no validation
 * step here the way add_suggested_policy_rule needs one — a suggestion's
 * "Generate" button calls generate_analytics_report directly.
 */
import { useEffect, useState } from "react";
import { BarChart3, Plus, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReportResult, ReportSpec, ReportSuggestion } from "@/lib/grid-engine";

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
  suggestions,
  onSend,
  onGenerateSuggestion,
}: {
  reports: ReportResult[];
  savedReportSpecs: ReportSpec[];
  /** Candidate reports computed from real current data (lib/domains/cinema.ts's listCinemaReportSuggestions) — not yet generated. */
  suggestions: ReportSuggestion[];
  /** Injects a prompt into the chat panel, same as every other "Send to chat" affordance in this app. */
  onSend: (prompt: string) => void;
  /** Runs generate_analytics_report directly for one suggestion — no chat round-trip needed, since a report has no risk to review first. */
  onGenerateSuggestion: (suggestion: ReportSuggestion) => void;
}) {
  const [subTab, setSubTab] = useState<"saved" | "suggested">("saved");
  const [draft, setDraft] = useState("");
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

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(`Generate an analytics report: "${text}"`);
    setDraft("");
  }

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 size-4 shrink-0 text-signal" />
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Analytics Reports</h3>
            <p className="mt-0.5 text-[11px] text-ink-dim">Describe one below, ask the copilot, or pick a suggestion.</p>
          </div>
        </div>
        {savedReportSpecs.length > 0 && (
          <Badge className="shrink-0 border-signal/40 bg-signal-soft text-signal">{savedReportSpecs.length} saved</Badge>
        )}
      </div>

      <div className="flex gap-1 border-b border-line bg-panel-2/60 px-3 pt-2">
        <button
          type="button"
          onClick={() => setSubTab("saved")}
          className={`rounded-t px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            subTab === "saved" ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
          }`}
        >
          Saved ({savedReportSpecs.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("suggested")}
          className={`flex items-center gap-1.5 rounded-t px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            subTab === "suggested" ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
          }`}
        >
          <Sparkles className="size-3" /> Suggested ({suggestions.length})
        </button>
      </div>

      {subTab === "saved" ? (
        <>
          <div className="border-b border-line bg-void-2/60 px-4 py-3">
            <p className="mb-2 text-[11px] leading-4 text-ink-dim">Describe a report in plain English — Gemini configures it.</p>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder='e.g. "Audio issues by CDN provider over the last 24 hours"'
                className="h-9 flex-1 rounded border border-line-bright bg-void-2 px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
              />
              <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                <Send className="size-3.5" /> Generate
              </Button>
            </div>
          </div>

          {!selected ? (
            <div className="px-4 py-8 text-center">
              <BarChart3 className="mx-auto mb-2 size-5 text-ink-faint" />
              <p className="text-xs font-medium text-ink-dim">No reports yet</p>
              <p className="mx-auto mt-1 max-w-[26ch] text-[11px] leading-4 text-ink-faint">
                Describe one above, or check the Suggested tab for ready-made candidates.
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
        </>
      ) : (
        <div className="px-4 py-3">
          <p className="mb-2.5 text-[11px] leading-4 text-ink-dim">Candidates computed from real current data.</p>
          {suggestions.length === 0 ? (
            <p className="text-[11px] leading-4 text-ink-faint">No new suggestions right now — every candidate is already saved.</p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div key={s.key} className="rounded border border-dashed border-line-bright bg-void-2/40 p-2.5">
                  <p className="text-xs font-medium leading-5 text-ink">{s.title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-ink-faint">{s.rationale}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      {s.matchCount} matching now
                    </span>
                    <Button size="sm" variant="outline" onClick={() => onGenerateSuggestion(s)}>
                      <Plus className="size-3.5" /> Generate
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
