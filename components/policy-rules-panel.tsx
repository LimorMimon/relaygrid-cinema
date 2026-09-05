"use client";
/**
 * "Policies" tab: Active sub-tab (compose-a-rule input + the numbered
 * active-rule list, highlighting every rule that currently has a pending
 * action card) and Suggested sub-tab (candidate rules computed from real
 * current data, each addable with one click). All state — policyRules,
 * suggestions, which rules are pending — lives in the parent
 * (cinema-grid-app.tsx) and the hook; this component only renders it.
 */
import { useEffect, useMemo, useState } from "react";
import { GitBranch, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Workflow, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeNodeLines, type PolicyRule, type PolicyRiskLevel, type PolicySuggestion, type QueryNode } from "@/lib/grid-engine";
import { CINEMA_DECISION_LADDERS, cinemaDomain, type CinemaActionId, type StreamRecord } from "@/lib/domains/cinema";
import { AllRulesCheckModal, DecisionLadderModal, PolicyFlowchartModal } from "@/components/policy-flowchart";

type FlowchartTarget = {
  title: string;
  description: string;
  root: QueryNode<StreamRecord>;
  actionId: CinemaActionId;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
  /** Set only when this is an already-active rule, so Validate Logic's conflict check can exclude it from otherRules. */
  ruleId?: string;
};

type LadderTarget = {
  title: string;
  description: string;
  triggerLabel: string;
  branches: { conditionLabel: string; actionLabel: string; riskLevel: PolicyRiskLevel }[];
};

function actionLabel(id: CinemaActionId): string {
  return cinemaDomain.actions.find((a) => a.id === id)?.label ?? id;
}

/** The compose-a-rule input's example text — also used as the Tab-to-fill value (see its onKeyDown below), so a judge can demo the flow without typing. */
const RULE_EXAMPLE = "Always restart the audio encoder when it desyncs on a healthy stream";

function riskBadgeClasses(riskLevel: "AUTONOMOUS" | "REQUIRES_APPROVAL"): string {
  return riskLevel === "AUTONOMOUS" ? "border-auto/40 bg-auto-soft text-auto" : "border-caution/40 bg-caution-soft text-caution";
}

export function PolicyRulesPanel({
  policyRules,
  onSend,
  suggestions,
  onAddSuggestion,
  onRefreshSuggestions,
  pendingRuleIds,
  records,
}: {
  policyRules: PolicyRule<StreamRecord, CinemaActionId>[];
  onSend: (prompt: string) => void;
  suggestions: PolicySuggestion<StreamRecord>[];
  onAddSuggestion: (key: string) => void;
  onRefreshSuggestions: () => void;
  /** Every rule currently asking for approval via a live action card, if any — each highlighted in the Active list. */
  pendingRuleIds?: Set<string>;
  /** Live records — lets the flowchart modal's "Validate Logic" button test a rule against real current data. */
  records: StreamRecord[];
}) {
  const [draft, setDraft] = useState("");
  const [subTab, setSubTab] = useState<"active" | "suggested">("active");
  const [complexityTab, setComplexityTab] = useState<"simple" | "complex">("simple");
  const [flowchart, setFlowchart] = useState<FlowchartTarget | null>(null);
  const [ladderView, setLadderView] = useState<LadderTarget | null>(null);
  const [allRulesCheckOpen, setAllRulesCheckOpen] = useState(false);

  // Bring the highlighted rule into view the moment it starts asking for approval.
  useEffect(() => {
    if (pendingRuleIds && pendingRuleIds.size > 0) setSubTab("active");
  }, [pendingRuleIds]);

  // Which decision ladder (if any) a given active rule belongs to — lets the
  // flowchart button open the combined if/else diagram instead of a
  // single-path one, and lets the list show "part of a branch" up front.
  const ladderByRuleId = useMemo(() => {
    const map = new Map<string, (typeof CINEMA_DECISION_LADDERS)[number]>();
    for (const ladder of CINEMA_DECISION_LADDERS) {
      for (const branch of ladder.branches) map.set(branch.ruleId, ladder);
    }
    return map;
  }, []);

  function openLadder(ladder: (typeof CINEMA_DECISION_LADDERS)[number]) {
    const branches = ladder.branches.map((b) => {
      const branchRule = policyRules.find((r) => r.id === b.ruleId);
      return {
        conditionLabel: b.conditionLabel,
        actionLabel: branchRule ? actionLabel(branchRule.actionId) : "Not yet active",
        riskLevel: branchRule?.riskLevel ?? ("AUTONOMOUS" as PolicyRiskLevel),
      };
    });
    setLadderView({
      title: ladder.title,
      description: `A genuine if/else on ${ladder.triggerLabel} — each branch is mutually exclusive and triggers a different action.`,
      triggerLabel: ladder.triggerLabel,
      branches,
    });
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(`Add a standing policy rule: "${text}"`);
    setDraft("");
  }

  // Demo-simulation grouping only — keeps the list short enough to skip
  // scrolling. "Complex" = genuinely nested logic (more than 2 top-level
  // branches) or part of an if/else decision ladder; everything else reads
  // as "simple" even when it's a 2-condition AND.
  const classifiedRules = policyRules.map((rule, i) => {
    const logicLines = describeNodeLines(rule.root);
    const ladder = ladderByRuleId.get(rule.id);
    return { rule, index: i, logicLines, ladder, isComplex: logicLines.length > 2 || Boolean(ladder) };
  });
  const visibleRules = classifiedRules.filter((r) => (complexityTab === "complex" ? r.isComplex : !r.isComplex));

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="border-b border-line bg-panel-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Zap className="mt-0.5 size-4 shrink-0 text-auto" />
            <div>
              <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Policy Rules</h3>
              <p className="mt-0.5 text-[11px] text-ink-dim">Standing automation, evaluated continuously.</p>
            </div>
          </div>
          <Badge className="shrink-0 border-auto/40 bg-auto-soft text-auto">{policyRules.length} active</Badge>
        </div>
        {/* Its own row, not squeezed onto the title row next to the badge — "Check All Rules" plus "N active" was overflowing this sidebar's width and getting clipped. */}
        <button
          type="button"
          title="Simulate every active rule against live data and against every other rule, all at once"
          onClick={() => setAllRulesCheckOpen(true)}
          disabled={policyRules.length === 0}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-line-bright bg-panel-2 px-2 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-dim hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="size-3" /> Check All Rules
        </button>
      </div>

      <div className="flex gap-1 border-b border-line bg-panel-2/60 px-3 pt-2">
        <button
          type="button"
          onClick={() => setSubTab("active")}
          className={`rounded-t px-3 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            subTab === "active" ? "border border-b-0 border-line bg-panel text-ink" : "text-ink-faint hover:text-ink-dim"
          }`}
        >
          Active ({policyRules.length})
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

      {subTab === "active" ? (
        <>
          <div className="border-b border-line bg-void-2/60 px-4 py-3">
            <p className="mb-2 text-[11px] leading-4 text-ink-dim">Describe a new rule in plain English — Gemini configures it.</p>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Tab" && !draft) {
                    e.preventDefault();
                    setDraft(RULE_EXAMPLE);
                  }
                }}
                placeholder={`e.g. "${RULE_EXAMPLE}" (Tab to fill in)`}
                className="h-9 flex-1 rounded border border-line-bright bg-void-2 px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal"
              />
              <Button size="sm" onClick={submit} disabled={!draft.trim()}>
                <Send className="size-3.5" /> Add Rule
              </Button>
            </div>
          </div>

          {policyRules.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Zap className="mx-auto mb-2 size-5 text-ink-faint" />
              <p className="text-xs font-medium text-ink-dim">No policy rules yet</p>
              <p className="mx-auto mt-1 max-w-[26ch] text-[11px] leading-4 text-ink-faint">Describe one above to get started.</p>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 border-b border-line bg-void-2/40 px-4 py-2">
                <button
                  type="button"
                  onClick={() => setComplexityTab("simple")}
                  className={`rounded-full border px-2.5 py-1 font-display text-[9px] font-bold uppercase tracking-wider transition-colors ${
                    complexityTab === "simple"
                      ? "border-signal/40 bg-signal-soft text-signal"
                      : "border-line-bright bg-panel-2 text-ink-faint hover:text-ink-dim"
                  }`}
                >
                  Simple ({classifiedRules.filter((r) => !r.isComplex).length})
                </button>
                <button
                  type="button"
                  onClick={() => setComplexityTab("complex")}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-display text-[9px] font-bold uppercase tracking-wider transition-colors ${
                    complexityTab === "complex"
                      ? "border-auto/40 bg-auto-soft text-auto"
                      : "border-line-bright bg-panel-2 text-ink-faint hover:text-ink-dim"
                  }`}
                >
                  <GitBranch className="size-2.5" /> Complex ({classifiedRules.filter((r) => r.isComplex).length})
                </button>
              </div>
              {visibleRules.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] leading-4 text-ink-faint">No {complexityTab} rules right now.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {visibleRules.map(({ rule, index: i, logicLines, ladder }) => {
                    const isPending = pendingRuleIds?.has(rule.id) ?? false;
                    return (
                      <li
                        key={rule.id}
                        className={
                          isPending
                            ? "border-l-2 border-transparent bg-caution-soft/50 px-4 py-3 ring-1 ring-inset ring-caution"
                            : "border-l-2 border-transparent px-4 py-3"
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-xs font-medium leading-5 text-ink">
                            <span className="mr-1.5 font-display font-bold text-ink-faint">#{i + 1}</span>
                            {rule.description}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              title={ladder ? `View combined if/else: ${ladder.title}` : "View as a flowchart"}
                              onClick={() =>
                                ladder
                                  ? openLadder(ladder)
                                  : setFlowchart({
                                      title: `Policy Rule #${i + 1}`,
                                      description: rule.description,
                                      root: rule.root,
                                      actionId: rule.actionId,
                                      actionLabel: actionLabel(rule.actionId),
                                      riskLevel: rule.riskLevel,
                                      ruleId: rule.id,
                                    })
                              }
                              className={`rounded border p-1 ${
                                ladder
                                  ? "border-signal/40 bg-signal-soft text-signal hover:border-signal"
                                  : "border-line-bright bg-panel-2 text-ink-faint hover:border-signal hover:text-signal"
                              }`}
                            >
                              {ladder ? <GitBranch className="size-3" /> : <Workflow className="size-3" />}
                            </button>
                            <Badge className={riskBadgeClasses(rule.riskLevel)}>{rule.riskLevel === "AUTONOMOUS" ? "Auto" : "Approval"}</Badge>
                          </div>
                        </div>

                        {ladder && (
                          <p className="ml-[1.4rem] mt-1 flex items-center gap-1 font-display text-[9px] font-semibold uppercase tracking-wide text-signal">
                            <GitBranch className="size-2.5" /> Branch of "{ladder.title}" — an if/else, not a standalone rule
                          </p>
                        )}

                        {/* The actual condition tree — one line per top-level branch, so a
                            genuinely nested rule visibly reads as multi-line logic, while a
                            simple one-condition rule stays exactly one line. */}
                        <div className="ml-[1.4rem] mt-1.5 space-y-0.5 rounded border border-line-bright/50 bg-void-2/60 px-2 py-1.5 font-display text-[10px] leading-4">
                          {logicLines.map((line, li) => (
                            <p key={li} className={li === 0 ? "text-ink" : "pl-3 text-ink-dim"}>
                              {li === 0 ? "IF " : ""}
                              {line}
                            </p>
                          ))}
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pl-[1.4rem]">
                          <p className="text-[11px] text-ink-dim">→ {actionLabel(rule.actionId)}</p>
                          {isPending && (
                            <span className="flex items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-wide text-caution">
                              <span className="size-1.5 animate-pulse-dot-caution rounded-full bg-caution" />
                              Awaiting your approval
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[11px] leading-4 text-ink-dim">Candidates computed from real current data.</p>
            <button
              type="button"
              title="Recompute suggestions"
              onClick={onRefreshSuggestions}
              className="rounded border border-line-bright bg-panel-2 p-1 text-ink-faint hover:border-signal hover:text-signal"
            >
              <RefreshCw className="size-3" />
            </button>
          </div>

          {suggestions.length === 0 ? (
            <p className="text-[11px] leading-4 text-ink-faint">You've added every suggestion — nice. Refresh after the grid changes.</p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div key={s.key} className="rounded border border-dashed border-line-bright bg-void-2/40 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-xs font-medium leading-5 text-ink">{s.description}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        title="View as a flowchart"
                        onClick={() =>
                          setFlowchart({
                            title: s.description,
                            description: s.rationale,
                            root: s.root,
                            actionId: s.actionId as CinemaActionId,
                            actionLabel: s.actionLabel,
                            riskLevel: s.riskLevel,
                          })
                        }
                        className="rounded border border-line-bright bg-panel-2 p-1 text-ink-faint hover:border-signal hover:text-signal"
                      >
                        <Workflow className="size-3" />
                      </button>
                      <Badge className={riskBadgeClasses(s.riskLevel)}>{s.riskLevel === "AUTONOMOUS" ? "Auto" : "Approval"}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-ink-dim">{s.rationale}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      Matches {s.matchCount} stream{s.matchCount === 1 ? "" : "s"} now
                    </span>
                    <Button size="sm" variant="outline" onClick={() => onAddSuggestion(s.key)}>
                      <Plus className="size-3.5" /> Add
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {flowchart && (
        <PolicyFlowchartModal
          title={flowchart.title}
          description={flowchart.description}
          root={flowchart.root}
          actionId={flowchart.actionId}
          actionLabel={flowchart.actionLabel}
          riskLevel={flowchart.riskLevel}
          ruleId={flowchart.ruleId}
          otherRules={policyRules}
          records={records}
          onClose={() => setFlowchart(null)}
        />
      )}
      {ladderView && (
        <DecisionLadderModal
          title={ladderView.title}
          description={ladderView.description}
          triggerLabel={ladderView.triggerLabel}
          branches={ladderView.branches}
          onClose={() => setLadderView(null)}
        />
      )}
      {allRulesCheckOpen && <AllRulesCheckModal rules={policyRules} records={records} onClose={() => setAllRulesCheckOpen(false)} />}
    </section>
  );
}
