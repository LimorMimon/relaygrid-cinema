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
import { Activity, AlertTriangle, BarChart3, Clapperboard, Database, Dices, RotateCcw, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelayGrid } from "@/components/relay-grid";
import { ActionCard } from "@/components/action-card";
import { AgentChatPanel, type AgentChatPanelHandle } from "@/components/agent-chat-panel";
import { JudgeGuide, GUIDE_STEPS } from "@/components/judge-guide";
import { ReportsPanel } from "@/components/reports-panel";
import { PolicyRulesPanel } from "@/components/policy-rules-panel";
import { useGridAgent, type PolicyOptions, type PreviewState, type ReportingOptions } from "@/hooks/use-grid-agent";
import {
  cinemaDomain,
  resolveCinemaPolicyRule,
  resolveCinemaReport,
  listPolicyRuleSuggestions,
  resolveSuggestedPolicyRule,
  injectRandomIncident,
  DEFAULT_POLICY_RULES,
  type StreamRecord,
  type CinemaActionId,
} from "@/lib/domains/cinema";
import type { PolicySuggestion } from "@/lib/grid-engine";
import { buildSystemInstruction } from "@/lib/agent-prompt";

const systemInstruction = buildSystemInstruction(cinemaDomain);

export default function CinemaGridApp() {
  const [injectedPrompt, setInjectedPrompt] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [middleTab, setMiddleTab] = useState<"guide" | "reports" | "policies">("guide");
  const chatRef = useRef<AgentChatPanelHandle>(null);

  const policyOptions = useMemo<PolicyOptions<StreamRecord, CinemaActionId>>(
    () => ({
      resolveRule: resolveCinemaPolicyRule,
      defaultRules: DEFAULT_POLICY_RULES,
      markAutoResolved: (record) => (record.statusFlags.length === 0 ? { ...record, status: "Auto-Resolved" } : record),
      onAutoExecuted: (message) => chatRef.current?.logPolicyMessage(message),
      onEscalated: (message) => chatRef.current?.logPolicyMessage(message),
      listSuggestions: listPolicyRuleSuggestions,
      resolveSuggestion: resolveSuggestedPolicyRule,
    }),
    [],
  );

  const reportingOptions = useMemo<ReportingOptions<StreamRecord, CinemaActionId>>(
    () => ({ resolveReport: resolveCinemaReport }),
    [],
  );

  const {
    records,
    results,
    visibleBatch,
    query,
    preview,
    audit,
    selected,
    setSelected,
    agentNotice,
    webmcpReady,
    policyRules,
    reports,
    savedReportSpecs,
    recentlyChangedIds,
    geminiTools,
    callTool,
    resetSession,
    dismissPreview,
    injectIncident,
  } = useGridAgent<StreamRecord, CinemaActionId>(cinemaDomain, policyOptions, reportingOptions);

  const [suggestions, setSuggestions] = useState<PolicySuggestion<StreamRecord>[]>([]);

  function refreshSuggestions() {
    const outcome = callTool("suggest_policy_rules", {});
    chatRef.current?.logToolResult("suggest_policy_rules", {}, outcome);
    if (outcome.ok) setSuggestions((outcome.result as { suggestions: PolicySuggestion<StreamRecord>[] }).suggestions);
  }

  function handleInjectIncident() {
    const result = injectIncident(injectRandomIncident);
    chatRef.current?.logSimulatedEvent("error" in result ? `🎲 ${result.error}` : `🎲 ${result.summary}`);
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

  // execute_action stays out of Gemini's toolset — only a human click on the
  // action card may ever run it. add_policy_rule IS exposed: creating a rule
  // isn't itself a mutation, and any AUTONOMOUS rule still passes through
  // the system's own risk clamp (lib/domains/cinema.ts) before it can run
  // without a human confirming anything.
  const chatTools = useMemo(() => geminiTools.filter((t) => t.name !== "execute_action"), [geminiTools]);
  const pendingIds = useMemo(() => new Set((preview?.plan ?? []).map((steps) => steps[0]?.recordId)), [preview]);

  const stats = [
    { label: "All streams", value: records.length.toLocaleString(), icon: Database },
    { label: "Current matches", value: results.length.toLocaleString(), icon: Activity },
    { label: "Flagged in view", value: results.filter((r) => r.statusFlags.length > 0).length.toLocaleString(), icon: AlertTriangle },
    { label: "Actions executed", value: audit.length.toLocaleString(), icon: Clapperboard },
    { label: "Active policies", value: policyRules.length.toLocaleString(), icon: Zap },
  ];

  const completedSteps = audit.length > 0 ? 4 : preview ? 3 : selected ? 2 : query ? 1 : 0;

  function executeAction(target: PreviewState<StreamRecord, CinemaActionId> | null) {
    if (!target) return;
    setExecuting(true);
    const args = { previewId: target.id, humanConfirmed: true };
    const outcome = callTool("execute_action", args);
    setExecuting(false);
    chatRef.current?.logToolResult("execute_action", args, outcome);
    if (!outcome.ok) {
      // Also surfaced via agentNotice by the handler itself when possible.
      console.error(outcome.error);
    }
  }

  function handleApprove() {
    executeAction(preview);
  }

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
          <Badge className="border-line-bright bg-panel-2 text-ink-dim">Gemini</Badge>
        </div>
      </header>

      <div className="rg-layout min-h-[calc(100vh-4rem)] w-full md:h-[calc(100vh-4rem)]">
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
                  <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
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
          <div className="flex shrink-0 gap-1 rounded border border-line bg-panel p-1">
            <button
              type="button"
              onClick={() => setMiddleTab("guide")}
              className={`flex-1 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                middleTab === "guide" ? "bg-signal text-void" : "text-ink-dim hover:text-ink"
              }`}
            >
              Guide
            </button>
            <button
              type="button"
              onClick={() => setMiddleTab("reports")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
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
              onClick={() => setMiddleTab("policies")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors ${
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
          </div>

          {middleTab === "guide" ? (
            <JudgeGuide
              completedSteps={completedSteps}
              onSend={setInjectedPrompt}
              onReset={resetSession}
              onAutoRun={runFullScenario}
              autoRunning={autoRunning}
            />
          ) : middleTab === "reports" ? (
            <ReportsPanel reports={reports} savedReportSpecs={savedReportSpecs} />
          ) : (
            <PolicyRulesPanel
              policyRules={policyRules}
              onSend={setInjectedPrompt}
              suggestions={suggestions}
              onAddSuggestion={addSuggestedRule}
              onRefreshSuggestions={refreshSuggestions}
              pendingRuleId={preview?.triggeredByRuleId}
            />
          )}
          {preview && <ActionCard preview={preview} busy={executing} onApprove={handleApprove} onDismiss={dismissPreview} />}
        </aside>

        {/* Same reasoning as rg-area-guide above: h-full within its tablet grid row, absolute calc(100vh-4rem) once it owns a full desktop column. */}
        <aside className="rg-area-chat flex min-w-0 max-w-full flex-col overflow-x-hidden border-t border-line bg-void-2 p-4 sm:p-5 md:sticky md:top-0 md:h-full md:min-h-0 md:overflow-y-auto md:border-l md:border-t-0 lg:h-[calc(100vh-4rem)]">
          <AgentChatPanel
            ref={chatRef}
            geminiTools={chatTools}
            systemInstruction={systemInstruction}
            callTool={callTool}
            injectedPrompt={injectedPrompt}
            onInjectedPromptConsumed={() => setInjectedPrompt(null)}
          />
        </aside>
      </div>
    </main>
  );
}
