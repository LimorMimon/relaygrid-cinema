"use client";
/**
 * "Policies" tab: Active sub-tab (compose-a-rule input + the numbered
 * active-rule list, highlighting whichever rule currently has a pending
 * action card) and Suggested sub-tab (candidate rules computed from real
 * current data, each addable with one click). All state — policyRules,
 * suggestions, which rule is pending — lives in the parent
 * (cinema-grid-app.tsx) and the hook; this component only renders it.
 */
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Send, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PolicyRule, PolicySuggestion } from "@/lib/grid-engine";
import { cinemaDomain, type CinemaActionId, type StreamRecord } from "@/lib/domains/cinema";

function actionLabel(id: CinemaActionId): string {
  return cinemaDomain.actions.find((a) => a.id === id)?.label ?? id;
}

function riskBadgeClasses(riskLevel: "AUTONOMOUS" | "REQUIRES_APPROVAL"): string {
  return riskLevel === "AUTONOMOUS" ? "border-auto/40 bg-auto-soft text-auto" : "border-caution/40 bg-caution-soft text-caution";
}

export function PolicyRulesPanel({
  policyRules,
  onSend,
  suggestions,
  onAddSuggestion,
  onRefreshSuggestions,
  pendingRuleId,
}: {
  policyRules: PolicyRule<StreamRecord, CinemaActionId>[];
  onSend: (prompt: string) => void;
  suggestions: PolicySuggestion[];
  onAddSuggestion: (key: string) => void;
  onRefreshSuggestions: () => void;
  /** The rule currently asking for approval via a live action card, if any — highlighted in the Active list. */
  pendingRuleId?: string;
}) {
  const [draft, setDraft] = useState("");
  const [subTab, setSubTab] = useState<"active" | "suggested">("active");

  // Bring the highlighted rule into view the moment it starts asking for approval.
  useEffect(() => {
    if (pendingRuleId) setSubTab("active");
  }, [pendingRuleId]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(`Add a standing policy rule: "${text}"`);
    setDraft("");
  }

  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 size-4 shrink-0 text-auto" />
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Policy Rules</h3>
            <p className="mt-0.5 text-[11px] text-ink-dim">Standing automation, evaluated continuously.</p>
          </div>
        </div>
        <Badge className="shrink-0 border-auto/40 bg-auto-soft text-auto">{policyRules.length} active</Badge>
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
                }}
                placeholder='e.g. "Always restart the audio encoder when it desyncs on a healthy stream"'
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
            <ul className="divide-y divide-line">
              {policyRules.map((rule, i) => {
                const isPending = rule.id === pendingRuleId;
                return (
                  <li
                    key={rule.id}
                    className={
                      isPending
                        ? "border-l-2 border-caution bg-caution-soft/50 px-4 py-3"
                        : "border-l-2 border-transparent px-4 py-3"
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-xs font-medium leading-5 text-ink">
                        <span className="mr-1.5 font-display font-bold text-ink-faint">#{i + 1}</span>
                        {rule.description}
                      </p>
                      <Badge className={`shrink-0 ${riskBadgeClasses(rule.riskLevel)}`}>{rule.riskLevel === "AUTONOMOUS" ? "Auto" : "Approval"}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pl-[1.4rem]">
                      <p className="text-[11px] text-ink-faint">→ {actionLabel(rule.actionId)}</p>
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
                    <Badge className={`shrink-0 ${riskBadgeClasses(s.riskLevel)}`}>{s.riskLevel === "AUTONOMOUS" ? "Auto" : "Approval"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-ink-faint">{s.rationale}</p>
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
    </section>
  );
}
