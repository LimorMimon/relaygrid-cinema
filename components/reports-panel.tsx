"use client";
/**
 * "Reports" tab: Active sub-tab (compose-a-report input + the reports
 * you've actually added, each re-runnable) and Suggested sub-tab
 * (candidate reports computed from real current data, each addable with
 * one click) — the exact same shape as PolicyRulesPanel's Active/Suggested
 * split, right down to a report moving from Suggested to Active the moment
 * you add it (see lib/domains/cinema.ts's listCinemaSuggestedReports,
 * which excludes anything already active).
 *
 * Reports are read-only and side-effect-free (unlike a policy rule,
 * nothing about a report changes standing automation), so there's no
 * validation step here the way add_suggested_policy_rule needs one — both
 * "Add" and "Run Report" call generate_analytics_report directly (via
 * onAddSuggestion/onRunSaved, which cinema-grid-app.tsx wires to callTool)
 * and hand the fresh result up via onResult, since a report worth naming
 * and pinning is worth reading somewhere bigger than this sidebar.
 *
 * The result modal itself (ReportResultModal, exported below) is rendered
 * by cinema-grid-app.tsx, not here — a report can just as easily come from
 * typing into the compose box above (which routes through the Gemini chat
 * panel, not this component) as from "Add"/"Run Report", and both need to
 * open the same modal. Owning the modal one level up, keyed off one shared
 * openReportResult state, is what makes chat-generated reports pop the
 * same modal instead of only leaving a text reply in the transcript.
 */
import { useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Play, Plus, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlowchartModalShell } from "@/components/policy-flowchart";
import type { ReportResult, ReportSpec, ReportSuggestion } from "@/lib/grid-engine";

/** The compose-a-report input's example text — also used as the Tab-to-fill value (see its onKeyDown below), so a judge can demo the flow without typing. */
const REPORT_EXAMPLE = "Audio issues by CDN provider over the last 24 hours";

/**
 * Horizontal single-hue bar list — rows are already sorted descending, so
 * the biggest bucket reads first at a glance. Each row expands on click to
 * the actual record ids in that group (row.recordIds) — a count on its own
 * ("11 in EU-West") answers "how many," not "which ones."
 */
function ReportBars({ result }: { result: ReportResult }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const max = result.rows[0]?.value ?? 0;
  return (
    <div className="space-y-2.5">
      {result.rows.map((row) => {
        const isOpen = openGroup === row.group;
        return (
          <div key={row.group}>
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : row.group)}
              className="flex w-full items-center gap-1.5 text-left"
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <ChevronDown className="size-3 shrink-0 text-ink-faint" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-ink-faint" />
              )}
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-ink">{row.group}</span>
                  <span className="shrink-0 font-display tabular-nums text-ink-dim">{row.value}</span>
                </span>
                <span className="block h-2 w-full overflow-hidden rounded-full bg-void-2">
                  <span
                    className="block h-full rounded-full bg-signal transition-[width]"
                    style={{ width: `${max > 0 ? Math.max((row.value / max) * 100, 4) : 0}%` }}
                  />
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="mb-1 ml-[18px] mt-1.5 flex flex-wrap gap-1">
                {row.recordIds.map((id) => (
                  <span
                    key={id}
                    className="rounded border border-line-bright bg-void-2 px-1.5 py-0.5 font-display text-[10px] text-ink-dim"
                  >
                    {id}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Full-size presentation of one report result — title, exact generation date, total, and the bar breakdown — in its own modal instead of a sidebar-sized preview. Rendered by cinema-grid-app.tsx (see this file's header comment), not by ReportsPanel itself. */
export function ReportResultModal({ result, onClose }: { result: ReportResult; onClose: () => void }) {
  const generated = new Date(result.generatedAt);
  return (
    <FlowchartModalShell
      title={result.spec.title}
      description={`Grouped by ${result.spec.groupBy} · ${result.spec.timeWindow === "all" ? "all time" : `last ${result.spec.timeWindow}`} · generated ${generated.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })} at ${generated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
      onClose={onClose}
    >
      <p className="font-display text-3xl font-semibold tabular-nums text-ink">{result.total}</p>
      <p className="-mt-0.5 mb-4 text-[11px] text-ink-faint">
        matching records total{result.rows.length > 0 ? " — click a group below to see which ones" : ""}
      </p>
      {result.rows.length > 0 ? (
        <ReportBars result={result} />
      ) : (
        <p className="text-xs text-ink-faint">Nothing matched this filter in the selected window.</p>
      )}
    </FlowchartModalShell>
  );
}

export function ReportsPanel({
  savedReportSpecs,
  suggestedReports,
  onSend,
  onAddSuggestion,
  onRunSaved,
  onResult,
}: {
  /** Reports that have actually been added — "Active", in the same sense as an active policy rule. */
  savedReportSpecs: ReportSpec[];
  /** Candidate reports computed from real current data (lib/domains/cinema.ts's listCinemaSuggestedReports) — excludes anything already in savedReportSpecs. */
  suggestedReports: ReportSuggestion[];
  /** Injects a prompt into the chat panel, same as every other "Send to chat" affordance in this app. */
  onSend: (prompt: string) => void;
  /** Adds one suggestion (generate_analytics_report with save_report: true) and returns the fresh result to open immediately — null on failure. */
  onAddSuggestion: (suggestion: ReportSuggestion) => ReportResult | null;
  /** Re-runs an already-active spec for current numbers (save_report: false — it's already saved, this doesn't duplicate it) and returns the fresh result. */
  onRunSaved: (spec: ReportSpec) => ReportResult | null;
  /** Hands a freshly generated result up to cinema-grid-app.tsx, which owns the shared modal (see this file's header comment). */
  onResult: (result: ReportResult) => void;
}) {
  const [subTab, setSubTab] = useState<"active" | "suggested">("active");
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(`Generate an analytics report: "${text}"`);
    setDraft("");
  }

  function handleAdd(suggestion: ReportSuggestion) {
    const result = onAddSuggestion(suggestion);
    if (result) onResult(result);
  }

  function handleRun(spec: ReportSpec) {
    const result = onRunSaved(spec);
    if (result) onResult(result);
  }

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 size-4 shrink-0 text-signal" />
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Analytics Reports</h3>
            <p className="mt-0.5 text-[11px] text-ink-dim">Describe one below, ask the copilot, or add a suggestion.</p>
          </div>
        </div>
        {savedReportSpecs.length > 0 && (
          <Badge className="shrink-0 border-signal/40 bg-signal-soft text-signal">{savedReportSpecs.length} active</Badge>
        )}
      </div>

      <div className="flex gap-1 border-b border-line bg-panel-2/60 px-3 pt-2">
        <button
          type="button"
          onClick={() => setSubTab("active")}
          className={`rounded-t px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            subTab === "active" ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
          }`}
        >
          Active ({savedReportSpecs.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("suggested")}
          className={`flex items-center gap-1.5 rounded-t px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            subTab === "suggested" ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
          }`}
        >
          <Sparkles className="size-3" /> Suggested ({suggestedReports.length})
        </button>
      </div>

      {subTab === "active" ? (
        <>
          <div className="border-b border-line bg-void-2/60 px-4 py-3">
            <p className="mb-2 text-[11px] leading-4 text-ink-dim">Describe a report in plain English — Gemini configures it.</p>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Tab" && !draft) {
                    e.preventDefault();
                    setDraft(REPORT_EXAMPLE);
                  }
                }}
                placeholder={`e.g. "${REPORT_EXAMPLE}" (Tab to fill in)`}
                className="h-9 flex-1 rounded border border-line-bright bg-void-2 px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
              />
              <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                <Send className="size-3.5" /> Generate
              </Button>
            </div>
          </div>

          {savedReportSpecs.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <BarChart3 className="mx-auto mb-2 size-5 text-ink-faint" />
              <p className="text-xs font-medium text-ink-dim">No active reports yet</p>
              <p className="mx-auto mt-1 max-w-[28ch] text-[11px] leading-4 text-ink-faint">
                Describe one above, or add one from the Suggested tab.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {savedReportSpecs.map((spec) => (
                <li key={spec.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-xs font-medium text-ink">{spec.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-ink-faint">
                        {spec.metric} by {spec.groupBy} · {spec.timeWindow}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => handleRun(spec)}>
                      <Play className="size-3.5" /> Run Report
                    </Button>
                  </div>
                  {/* Same rationale text a Suggested card shows before it's added — carried onto the spec (see runReport in cinema-grid-app.tsx) so it isn't lost once a report becomes Active. */}
                  {spec.rationale && <p className="mt-1.5 text-[11px] leading-4 text-ink-faint">{spec.rationale}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="px-4 py-3">
          <p className="mb-2.5 text-[11px] leading-4 text-ink-dim">Candidates computed from real current data.</p>
          {suggestedReports.length === 0 ? (
            <p className="text-[11px] leading-4 text-ink-faint">You've added every suggestion — nice. Check back after the grid changes.</p>
          ) : (
            <div className="space-y-2">
              {suggestedReports.map((s) => (
                <div key={s.key} className="rounded border border-dashed border-line-bright bg-void-2/40 p-2.5">
                  <p className="text-xs font-medium leading-5 text-ink">{s.title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-ink-faint">{s.rationale}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{s.matchCount} matching now</span>
                    <Button size="sm" variant="outline" onClick={() => handleAdd(s)}>
                      <Plus className="size-3.5" /> Add
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
