"use client";
/**
 * Top-level page for the Media & Streaming domain — the piece that plugs
 * `cinemaDomain` (lib/domains/cinema.ts) into `useGridAgent` (the generic
 * hook) and lays out the three-column control room: the stream grid on the
 * left, a tabbed Guide/Reports/Policies column in the middle (plus whatever
 * action card is currently pending review), and the Gemini chat panel on
 * the right. Every domain gets its own file shaped like this one; nothing
 * here is reusable across domains on purpose.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Clapperboard, Database, Dices, MousePointerClick, Plug, RotateCcw, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelayGrid } from "@/components/relay-grid";
import { ActionCard } from "@/components/action-card";
import { AgentChatPanel, type AgentChatPanelHandle } from "@/components/agent-chat-panel";
import { JudgeGuide, GUIDE_STEPS } from "@/components/judge-guide";
import { ReportsPanel, ReportResultModal } from "@/components/reports-panel";
import { PolicyRulesPanel } from "@/components/policy-rules-panel";
import { SponsorIntegrations } from "@/components/sponsor-integrations";
import { useGridAgent, type PolicyOptions, type PreviewState, type ReportingOptions } from "@/hooks/use-grid-agent";
import { ingestSponsorEventRemote, publishSponsorEvent } from "@/lib/sponsor-event-bus";
import {
  cinemaDomain,
  resolveCinemaPolicyRule,
  resolveCinemaReport,
  listPolicyRuleSuggestions,
  resolveSuggestedPolicyRule,
  listCinemaSuggestedReports,
  injectRandomIncident,
  DEFAULT_POLICY_RULES,
  DEFAULT_REPORT_SPECS,
  type StreamRecord,
  type CinemaActionId,
} from "@/lib/domains/cinema";
import type { PolicySuggestion, ReportResult, ReportSpec, ReportSuggestion } from "@/lib/grid-engine";
import { buildSystemInstruction } from "@/lib/agent-prompt";

const systemInstruction = buildSystemInstruction(cinemaDomain);

export default function CinemaGridApp() {
  const [injectedPrompt, setInjectedPrompt] = useState<string | null>(null);
  // Which pending preview's Approve & Execute button is mid-click, if any —
  // several cards can be on screen at once, so this can't be a single flag.
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [middleTab, setMiddleTab] = useState<"guide" | "reports" | "policies" | "integrations">("guide");
  const chatRef = useRef<AgentChatPanelHandle>(null);

  // Which AgentBackend the server is actually running (see
  // app/api/agent-backend-info/route.ts) — truthfully reflects AGENT_BACKEND,
  // never hardcoded, so the header badge can't silently drift from reality.
  const [agentBackendId, setAgentBackendId] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/agent-backend-info")
      .then((res) => res.json())
      .then((data: { id?: string }) => setAgentBackendId(data.id ?? null))
      .catch(() => setAgentBackendId(null));
  }, []);

  const policyOptions = useMemo<PolicyOptions<StreamRecord, CinemaActionId>>(
    () => ({
      resolveRule: resolveCinemaPolicyRule,
      defaultRules: DEFAULT_POLICY_RULES,
      markAutoResolved: (record) => (record.statusFlags.length === 0 ? { ...record, status: "Auto-Resolved" } : record),
      onAutoExecuted: (message) => chatRef.current?.logPolicyMessage(message),
      onEscalated: (message) => chatRef.current?.logPolicyMessage(message),
      onRuleWarning: (message) => chatRef.current?.logRuleWarning(message),
      onRuleCheckStep: (message) => chatRef.current?.logValidationStep(message),
      listSuggestions: listPolicyRuleSuggestions,
      resolveSuggestion: resolveSuggestedPolicyRule,
    }),
    [],
  );

  const reportingOptions = useMemo<ReportingOptions<StreamRecord, CinemaActionId>>(
    () => ({ resolveReport: resolveCinemaReport, defaultSpecs: DEFAULT_REPORT_SPECS }),
    [],
  );

  const {
    records,
    results,
    visibleBatch,
    query,
    previews,
    audit,
    selected,
    setSelected,
    agentNotice,
    webmcpReady,
    policyRules,
    savedReportSpecs,
    recentlyChangedIds,
    geminiTools,
    callTool,
    resetSession,
    dismissPreview,
    injectIncident,
  } = useGridAgent<StreamRecord, CinemaActionId>(cinemaDomain, policyOptions, reportingOptions);

  const [suggestions, setSuggestions] = useState<PolicySuggestion<StreamRecord>[]>([]);
  // The one report result currently open in its modal, however it was generated —
  // "Add"/"Run Report" in the Reports tab (via ReportsPanel's onResult) or a plain-English
  // request Gemini turned into a generate_analytics_report call in the chat panel (via
  // callToolForChat below). One shared state means both paths open the exact same modal
  // instead of the chat path only leaving a text reply in the transcript.
  const [openReportResult, setOpenReportResult] = useState<ReportResult | null>(null);

  function refreshSuggestions() {
    const outcome = callTool("suggest_policy_rules", {});
    chatRef.current?.logToolResult("suggest_policy_rules", {}, outcome);
    if (outcome.ok) setSuggestions((outcome.result as { suggestions: PolicySuggestion<StreamRecord>[] }).suggestions);
  }

  /**
   * The incident itself is published as its own sponsor event, independent
   * of whatever the policy engine decides to do about it. Without this, an
   * incident that only matches a REQUIRES_APPROVAL rule wouldn't appear in
   * the Integrations tabs until a human clicks Approve & Execute on the
   * resulting card — "Inject Incident" would look like it did nothing.
   */
  function handleInjectIncident() {
    const result = injectIncident(injectRandomIncident);
    if ("error" in result) {
      chatRef.current?.logSimulatedEvent(`🎲 ${result.error}`);
      return;
    }
    chatRef.current?.logSimulatedEvent(`🎲 ${result.summary}`);
    const record = result.records.find((r) => r.id === result.changedId);
    ingestSponsorEventRemote(
      publishSponsorEvent({
        kind: "incident_injected",
        source: "human",
        summary: result.summary,
        payload: {
          recordId: result.changedId,
          channel: record?.channel,
          audioStatus: record?.audioStatus,
          subtitleSync: record?.subtitleSync,
          bitrateMbps: record?.bitrateMbps,
          status: record?.status,
          statusFlags: record?.statusFlags,
        },
      }),
    );
  }

  function addSuggestedRule(key: string) {
    const args = { suggestion_key: key };
    const outcome = callTool("add_suggested_policy_rule", args);
    chatRef.current?.logToolResult("add_suggested_policy_rule", args, outcome);
    if (outcome.ok) {
      const result = outcome.result as { remainingSuggestions?: PolicySuggestion<StreamRecord>[] };
      if (result.remainingSuggestions) setSuggestions(result.remainingSuggestions);
    }
  }

  // Suggestions are deterministic and cheap (no Gemini call), so compute
  // them once up front rather than waiting for the user to open the tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshSuggestions(); }, []);

  // Report suggestions are pure derived data (no MCP round-trip needed,
  // unlike policy-rule suggestions) — recomputed live whenever the grid,
  // audit trail, or active-report list changes, so match counts and the
  // already-active exclusion never go stale.
  const suggestedReports = useMemo(
    () => listCinemaSuggestedReports(records, audit, savedReportSpecs),
    [records, audit, savedReportSpecs],
  );

  /** Shared by both Reports actions below — callTool is synchronous, so the returned ReportResult is never stale. */
  function runReport(args: {
    report_title: string;
    time_window: string;
    filter_metric: string;
    group_by: string;
    save_report: boolean;
    report_rationale?: string;
  }): ReportResult | null {
    const outcome = callTool("generate_analytics_report", args);
    chatRef.current?.logToolResult("generate_analytics_report", args, outcome);
    if (!outcome.ok) return null;
    const r = outcome.result as {
      reportId: string;
      title: string;
      timeWindow: string;
      groupBy: string;
      rows: ReportResult["rows"];
      total: number;
      generatedAt: string;
    };
    const result: ReportResult = {
      spec: {
        id: r.reportId,
        title: r.title,
        timeWindow: r.timeWindow as ReportResult["spec"]["timeWindow"],
        metric: args.filter_metric,
        groupBy: r.groupBy,
        createdAt: r.generatedAt,
        rationale: args.report_rationale,
      },
      rows: r.rows,
      total: r.total,
      generatedAt: r.generatedAt,
    };
    // Direct calls (Add / Run Report) never go through a Gemini turn, so
    // without this the transcript would only ever show the terse ⚙ tool-log
    // line above — never the narrated breakdown a chat-typed report gets.
    chatRef.current?.logReportSummary(result);
    return result;
  }

  /** Suggested tab's "Add" — saves it, which is what moves it into Active on the next render (see listCinemaSuggestedReports's exclusion). */
  function addSuggestedReport(suggestion: ReportSuggestion): ReportResult | null {
    return runReport({
      report_title: suggestion.title,
      time_window: suggestion.timeWindow,
      filter_metric: suggestion.filterMetric,
      group_by: suggestion.groupBy,
      save_report: true,
      report_rationale: suggestion.rationale,
    });
  }

  /** Active tab's "Run Report" — re-runs an already-active spec for fresh numbers without creating a second saved entry. */
  function runSavedReport(spec: ReportSpec): ReportResult | null {
    return runReport({
      report_title: spec.title,
      time_window: spec.timeWindow,
      filter_metric: spec.metric,
      group_by: spec.groupBy,
      save_report: false,
      report_rationale: spec.rationale,
    });
  }

  // execute_action stays out of Gemini's toolset — only a human click on the
  // action card may ever run it. add_policy_rule IS exposed: creating a rule
  // isn't itself a mutation, and any AUTONOMOUS rule still passes through
  // the system's own risk clamp (lib/domains/cinema.ts) before it can run
  // without a human confirming anything.
  const chatTools = useMemo(() => geminiTools.filter((t) => t.name !== "execute_action"), [geminiTools]);

  /**
   * The exact same callTool the rest of this component uses, except a
   * successful generate_analytics_report call also opens the shared result
   * modal — so a plain-English report typed into the Reports composer (which
   * only ever reaches Gemini, never runReport above) gets the same modal a
   * click on "Add"/"Run Report" gets, not just Gemini's text reply in the
   * transcript.
   */
  function callToolForChat(name: string, args: unknown) {
    const outcome = callTool(name, args);
    if (name === "generate_analytics_report" && outcome.ok) {
      const a = args as { filter_metric?: string; report_rationale?: string };
      const r = outcome.result as {
        reportId: string;
        title: string;
        timeWindow: string;
        groupBy: string;
        rows: ReportResult["rows"];
        total: number;
        generatedAt: string;
      };
      setOpenReportResult({
        spec: {
          id: r.reportId,
          title: r.title,
          timeWindow: r.timeWindow as ReportResult["spec"]["timeWindow"],
          metric: a.filter_metric ?? "",
          groupBy: r.groupBy,
          createdAt: r.generatedAt,
          rationale: a.report_rationale,
        },
        rows: r.rows,
        total: r.total,
        generatedAt: r.generatedAt,
      });
    }
    return outcome;
  }
  const pendingIds = useMemo(
    () => new Set(previews.flatMap((p) => p.plan.map((steps) => steps[0]?.recordId))),
    [previews],
  );
  const pendingRuleIds = useMemo(
    () => new Set(previews.map((p) => p.triggeredByRuleId).filter((id): id is string => id !== undefined)),
    [previews],
  );

  const stats = [
    { label: "All streams", value: records.length.toLocaleString(), icon: Database },
    { label: "Current matches", value: results.length.toLocaleString(), icon: Activity },
    { label: "Flagged in view", value: results.filter((r) => r.statusFlags.length > 0).length.toLocaleString(), icon: AlertTriangle },
    { label: "Actions executed", value: audit.length.toLocaleString(), icon: Clapperboard },
    { label: "Active policies", value: policyRules.length.toLocaleString(), icon: Zap },
  ];

  // Deliberately narrower than "any audit/preview exists" — the autonomous
  // policy engine ticks in the background from the moment the grid loads,
  // auto-resolving low-risk faults and escalating others into pending
  // approval cards, independent of anything the Judge Demo Guide's own
  // walkthrough does. Counting those would make this show 4/4 complete
  // before a visitor has touched a single guide step. `source === "human"`
  // (an Approve & Execute click) and `triggeredByRuleId === undefined` (a
  // preview from the chat's own preview_action call, not a policy
  // escalation) isolate the guide's own progress from that background noise.
  const completedSteps = audit.some((entry) => entry.source === "human")
    ? 4
    : previews.some((p) => p.triggeredByRuleId === undefined)
      ? 3
      : selected
        ? 2
        : query
          ? 1
          : 0;

  function executeAction(target: PreviewState<StreamRecord, CinemaActionId>) {
    setExecutingId(target.id);
    const args = { previewId: target.id, humanConfirmed: true };
    const outcome = callTool("execute_action", args);
    setExecutingId(null);
    chatRef.current?.logToolResult("execute_action", args, outcome);
    if (!outcome.ok) {
      // Also surfaced via agentNotice by the handler itself when possible.
      console.error(outcome.error);
    }
  }

  function handleApprove(target: PreviewState<StreamRecord, CinemaActionId>) {
    executeAction(target);
  }

  // Rendered in two places (rg-area-guide below 2xl, rg-area-actions from 2xl
  // up — see globals.css's 1536px tier) so pending approvals never depend on
  // which tab happens to be open once there's room for their own column.
  const previewCards = previews.map((preview) => (
    <ActionCard
      key={preview.id}
      preview={preview}
      busy={executingId === preview.id}
      onApprove={() => handleApprove(preview)}
      onDismiss={() => dismissPreview(preview.id)}
    />
  ));

  async function runFullScenario() {
    if (autoRunning) return;
    resetSession();
    chatRef.current?.resetConversation();
    setAutoRunning(true);
    try {
      // Runs the filter → verify → preview prompts automatically, then stops.
      // Step 4 (execute) is deliberately left to a real click on the action
      // card's Approve & Execute button — that human confirmation is the
      // point of the scenario, not something this button should skip.
      const prompts = GUIDE_STEPS.slice(0, 3).map((step) => step.prompt!);
      await chatRef.current?.runSequence(prompts);
    } finally {
      setAutoRunning(false);
    }
  }

  return (
    <main className="min-h-screen w-full max-w-full overflow-x-hidden bg-void font-body text-ink">
      <header className="relative flex h-16 items-center justify-between gap-4 border-b border-line bg-panel px-4 sm:px-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/70 to-transparent" />
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded border border-signal/40 bg-signal-soft text-signal shadow-[0_0_18px_rgba(55,230,196,0.25)]">
            <Clapperboard className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">RelayGrid <span className="text-signal">Cinema</span></h1>
            <p className="text-[11px] text-ink-dim">Media &amp; streaming operations grid</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge
            className={
              webmcpReady
                ? "border-signal/35 bg-signal-soft text-signal"
                : "border-caution/35 bg-caution-soft text-caution"
            }
          >
            <span
              className={`size-1.5 rounded-full ${webmcpReady ? "animate-pulse-dot bg-signal" : "bg-caution"}`}
            />
            {webmcpReady ? "WebMCP Live" : "WebMCP Offline"}
          </Badge>
          <Badge
            title={
              agentBackendId === "agent-builder"
                ? "Gemini function-calling routed through Vertex AI on a real Google Cloud project (lib/agent-backends/agent-builder.ts)."
                : "Gemini function-calling via the public AI Studio API (lib/agent-backends/gemini-direct.ts)."
            }
            className={
              agentBackendId === "agent-builder"
                ? "border-signal/35 bg-signal-soft text-signal"
                : "border-line-bright bg-panel-2 text-ink-dim"
            }
          >
            {agentBackendId === "agent-builder" && <span className="size-1.5 animate-pulse-dot rounded-full bg-signal" />}
            {agentBackendId === "agent-builder" ? "Google Cloud · Vertex AI" : "Gemini API"}
          </Badge>
        </div>
      </header>

      <div className={`rg-layout min-h-[calc(100vh-4rem)] w-full md:h-[calc(100vh-4rem)] ${previewCards.length === 0 ? "rg-layout--no-actions" : ""}`}>
        <section className="rg-area-grid flex min-w-0 flex-col overflow-x-hidden p-4 sm:p-6 md:sticky md:top-0 md:h-[calc(100vh-4rem)]">
          <div className="shrink-0">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[.2em] text-signal">Cinema operations</p>
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink">Stream worklist</h2>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleInjectIncident}
                  title="Demo tooling: mutates a random healthy stream to prove the policy engine reacts to genuinely new data, not just the seeded dataset."
                  className="border-dashed text-ink-dim hover:border-ink-dim hover:text-ink"
                >
                  <Dices className="size-3.5" /> Inject Incident
                </Button>
                <Button size="sm" variant="outline" onClick={resetSession}>
                  <RotateCcw className="size-3.5" /> Reset session
                </Button>
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {stats.map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded border border-line bg-panel p-4">
                  <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
                    <span>{label}</span>
                    <Icon className="size-3.5 text-ink-faint" />
                  </div>
                  <p className="font-display text-2xl font-semibold tabular-nums text-ink">{value}</p>
                </div>
              ))}
            </div>
            {agentNotice && (
              <div className="mb-4 rounded border border-caution/40 bg-caution-soft px-3 py-2 text-xs font-medium text-caution">
                <strong className="font-display font-bold uppercase tracking-wide">Request rejected</strong> — {agentNotice.message}
              </div>
            )}
          </div>
          {/* The only part of this column that scrolls — title, stats, and the
              banner above stay put (shrink-0) so they're always visible while
              scrolling through 220 rows. min-h-0 is required for a flex child
              to actually shrink and let its own overflow-y-auto take effect. */}
          <div className="min-h-0 flex-1">
            <RelayGrid
              visibleBatch={visibleBatch}
              totalMatches={results.length}
              totalRecords={records.length}
              selectedId={selected?.id}
              pendingIds={pendingIds}
              recentlyChangedIds={recentlyChangedIds}
              onSelect={setSelected}
            />
          </div>
        </section>

        {/*
          Height differs by tier on purpose: at tablet "guide" only occupies
          one of two stacked rows within its column (see the 768px media
          query in globals.css), so it must fill that cell (h-full,
          min-h-0) rather than claim the whole viewport height; at desktop
          it's the sole occupant of its own full-height column, so lg:
          switches it to the same absolute calc(100vh-4rem) the grid and
          chat columns use.
        */}
        <aside className="rg-area-guide flex min-w-0 max-w-full flex-col gap-4 overflow-x-hidden border-t border-line bg-void-2 p-4 sm:p-5 md:sticky md:top-0 md:h-full md:min-h-0 md:overflow-y-auto md:border-l md:border-t-0 lg:h-[calc(100vh-4rem)]">
          {/*
            Left to right follows the actual workflow: Policies (the
            standing config, already in place before anything happens) ->
            Guide (the manual step-by-step scenario that exercises it) ->
            Reports (a retrospective over what those steps produced). The
            default *selected* tab stays "guide" below (still the intended
            landing point for a judge) regardless of this button order.
          */}
          {/*
            2x2 grid, not a single row — a 4th flex-1 tab (Integrations)
            no longer fits one row at this column's narrowest width
            (min 300px at desktop), and the resulting overflow forced the
            whole sticky panel to scroll horizontally, clipping content.
            A grid sidesteps the fit problem entirely at every breakpoint.
          */}
          <div className="grid shrink-0 grid-cols-2 gap-1 rounded border border-line bg-panel p-1">
            <button
              type="button"
              onClick={() => setMiddleTab("policies")}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                middleTab === "policies" ? "bg-signal text-void" : "text-ink-dim hover:text-ink"
              }`}
            >
              <Zap className="size-3.5" />
              Policies
              {policyRules.length > 0 && (
                <span
                  className={`grid size-4 place-items-center rounded-full font-display text-[9px] font-bold ${
                    middleTab === "policies" ? "bg-void/25 text-void" : "bg-signal-soft text-signal"
                  }`}
                >
                  {policyRules.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMiddleTab("guide")}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                middleTab === "guide" ? "bg-signal text-void" : "text-ink-dim hover:text-ink"
              }`}
            >
              <MousePointerClick className="size-3.5" />
              Guide
            </button>
            <button
              type="button"
              onClick={() => setMiddleTab("reports")}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                middleTab === "reports" ? "bg-signal text-void" : "text-ink-dim hover:text-ink"
              }`}
            >
              <BarChart3 className="size-3.5" />
              Reports
              {savedReportSpecs.length > 0 && (
                <span
                  className={`grid size-4 place-items-center rounded-full font-display text-[9px] font-bold ${
                    middleTab === "reports" ? "bg-void/25 text-void" : "bg-signal-soft text-signal"
                  }`}
                >
                  {savedReportSpecs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMiddleTab("integrations")}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                middleTab === "integrations" ? "bg-signal text-void" : "text-ink-dim hover:text-ink"
              }`}
            >
              <Plug className="size-3.5" />
              Integrations
            </button>
          </div>

          {middleTab === "policies" ? (
            <PolicyRulesPanel
              policyRules={policyRules}
              onSend={setInjectedPrompt}
              suggestions={suggestions}
              onAddSuggestion={addSuggestedRule}
              onRefreshSuggestions={refreshSuggestions}
              pendingRuleIds={pendingRuleIds}
              records={records}
            />
          ) : middleTab === "guide" ? (
            <JudgeGuide
              completedSteps={completedSteps}
              onSend={setInjectedPrompt}
              onReset={resetSession}
              onAutoRun={runFullScenario}
              autoRunning={autoRunning}
            />
          ) : middleTab === "reports" ? (
            <ReportsPanel
              savedReportSpecs={savedReportSpecs}
              suggestedReports={suggestedReports}
              onSend={setInjectedPrompt}
              onAddSuggestion={addSuggestedReport}
              onRunSaved={runSavedReport}
              onResult={setOpenReportResult}
            />
          ) : (
            <SponsorIntegrations />
          )}
          {/* Below the 4th-column breakpoint, pending action cards stay right here, under whichever tab is open — 2xl:hidden below hands them to rg-area-actions instead once there's room for its own column. `contents` keeps them direct children of this flex column (so the existing gap-4 spacing still applies) rather than nested one div deeper. */}
          <div className="contents 2xl:hidden">{previewCards}</div>
          {openReportResult && <ReportResultModal result={openReportResult} onClose={() => setOpenReportResult(null)} />}
        </aside>

        {/*
          Wide-desktop-only 4th column (see the 1536px tier in globals.css) —
          pending action cards get a column of their own instead of sharing
          rg-area-guide with whatever tab is open, so several at once never
          risk getting pushed below a long Reports/Policies list. Hidden
          entirely below 2xl; rg-area-guide's `contents 2xl:hidden` block
          above renders the same cards there instead.

          Rendered only when there's actually something pending — not just
          content-hidden with an empty-state message — so the `rg-layout--no-actions`
          class above can drop this column's grid track entirely and let
          rg-area-grid's minmax(0, 1fr) claim the freed width instead of
          leaving a reserved-but-empty gap. guide/chat simply end up one
          column to the left; nothing else needs to react to this.
        */}
        {previewCards.length > 0 && (
          <aside className="rg-area-actions hidden min-w-0 max-w-full flex-col gap-4 overflow-x-hidden border-t border-line bg-void-2 p-4 2xl:sticky 2xl:top-0 2xl:flex 2xl:h-[calc(100vh-4rem)] 2xl:min-h-0 2xl:overflow-y-auto 2xl:border-l 2xl:border-t-0 2xl:p-5">
            <div>
              <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Pending Approvals</h3>
              <p className="mt-0.5 text-[11px] text-ink-dim">Action cards awaiting Approve &amp; Execute.</p>
            </div>
            {previewCards}
          </aside>
        )}

        {/* Same reasoning as rg-area-guide above: h-full within its tablet grid row, absolute calc(100vh-4rem) once it owns a full desktop column. */}
        <aside className="rg-area-chat flex min-w-0 max-w-full flex-col overflow-x-hidden border-t border-line bg-void-2 p-4 sm:p-5 md:sticky md:top-0 md:h-full md:min-h-0 md:overflow-y-auto md:border-l md:border-t-0 lg:h-[calc(100vh-4rem)]">
          <AgentChatPanel
            ref={chatRef}
            geminiTools={chatTools}
            systemInstruction={systemInstruction}
            callTool={callToolForChat}
            injectedPrompt={injectedPrompt}
            onInjectedPromptConsumed={() => setInjectedPrompt(null)}
            agentBackendId={agentBackendId}
          />
        </aside>
      </div>
    </main>
  );
}
