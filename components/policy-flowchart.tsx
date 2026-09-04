"use client";
/**
 * Renders a PolicyRule's condition tree as an actual top-to-bottom
 * flowchart (decision gates connected by AND/OR/NOT connectors, ending at
 * the action it triggers) — a visual companion to the text logic lines in
 * policy-rules-panel.tsx. Also renders a genuine if/else: two rules that
 * react to different values of the same field with different actions,
 * shown together as one branching diagram (see DecisionLadderFlowchart).
 */
import { useState } from "react";
import { AlertTriangle, CircleCheck, Info, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validatePolicyRule, type PolicyRule, type PolicyRuleValidation, type QueryNode, type PolicyRiskLevel } from "@/lib/grid-engine";
import { cinemaDomain, type CinemaActionId, type StreamRecord } from "@/lib/domains/cinema";

const OPERATOR_SYMBOLS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  in: "in",
  contains: "contains",
  after: "after",
  before: "before",
};

function Connector({ label, tone }: { label: string; tone: "gate" | "not" }) {
  return (
    <div className="flex flex-col items-center">
      <div className="h-3 w-px bg-line-bright" />
      <span
        className={`rounded-full border px-2 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider ${
          tone === "not" ? "border-alert/40 bg-alert-soft text-alert" : "border-signal/40 bg-signal-soft text-signal"
        }`}
      >
        {label}
      </span>
      <div className="h-3 w-px bg-line-bright" />
    </div>
  );
}

function FlowNode({ node }: { node: QueryNode<StreamRecord> }) {
  if (node.kind === "condition") {
    const value = Array.isArray(node.value) ? `[${node.value.join(", ")}]` : String(node.value);
    return (
      <div className="rounded border border-line-bright bg-void-2 px-3 py-2 text-center font-display text-[11px] leading-4 text-ink">
        {node.field} <span className="text-signal">{OPERATOR_SYMBOLS[node.operator] ?? node.operator}</span> {value}
      </div>
    );
  }
  if (node.kind === "not") {
    return (
      <div className="flex flex-col items-center">
        <span className="rounded-full border border-alert/40 bg-alert-soft px-2.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-alert">
          NOT
        </span>
        <div className="h-3 w-px bg-line-bright" />
        <FlowNode node={node.child} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center">
      {node.children.map((child, i) => (
        <div key={i} className="flex flex-col items-center">
          {i > 0 && <Connector label={node.operator} tone="gate" />}
          <FlowNode node={child} />
        </div>
      ))}
    </div>
  );
}

function ActionBox({ label, riskLevel, compact }: { label: string; riskLevel: PolicyRiskLevel; compact?: boolean }) {
  return (
    <div
      className={`rounded border-2 text-center font-display font-bold ${compact ? "w-full px-2 py-2 text-[10px]" : "mt-1 max-w-[85%] px-4 py-2.5 text-xs"} ${
        riskLevel === "AUTONOMOUS" ? "border-auto bg-auto-soft text-auto" : "border-caution bg-caution-soft text-caution"
      }`}
    >
      {label}
      <div className="mt-0.5 font-display text-[9px] font-normal uppercase tracking-wide opacity-80">
        {riskLevel === "AUTONOMOUS" ? "Runs automatically" : "Requires approval"}
      </div>
    </div>
  );
}

const StartPill = () => (
  <span className="rounded-full border border-line-bright bg-panel-2 px-3 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-ink-dim">
    Every evaluation tick
  </span>
);

const DownArrow = () => <div className="h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-line-bright" />;

export function PolicyFlowchart({
  root,
  actionLabel,
  riskLevel,
}: {
  root: QueryNode<StreamRecord>;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
}) {
  return (
    <div className="flex flex-col items-center gap-0 py-2">
      <StartPill />
      <div className="h-4 w-px bg-line-bright" />
      <FlowNode node={root} />
      <div className="h-4 w-px bg-line-bright" />
      <DownArrow />
      <ActionBox label={actionLabel} riskLevel={riskLevel} />
    </div>
  );
}

/** A genuine if/else: one shared trigger field, splitting into 2+ mutually exclusive branches, each ending in its own action. */
export function DecisionLadderFlowchart({
  triggerLabel,
  branches,
}: {
  triggerLabel: string;
  branches: { conditionLabel: string; actionLabel: string; riskLevel: PolicyRiskLevel }[];
}) {
  return (
    <div className="flex flex-col items-center gap-0 py-2">
      <StartPill />
      <div className="h-4 w-px bg-line-bright" />
      <div className="rounded border border-line-bright bg-void-2 px-3 py-2 text-center font-display text-[11px] leading-4 text-ink">
        {triggerLabel}
      </div>
      <div className="h-3 w-px bg-line-bright" />
      {/* Horizontal tee: a shared line splitting into one stem per branch. */}
      <div className="relative flex w-full justify-center">
        <div className="absolute top-0 h-px bg-line-bright" style={{ left: `${50 / branches.length}%`, right: `${50 / branches.length}%` }} />
      </div>
      <div className="grid w-full gap-3" style={{ gridTemplateColumns: `repeat(${branches.length}, minmax(0, 1fr))` }}>
        {branches.map((b, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="h-3 w-px bg-line-bright" />
            <span className="rounded-full border border-signal/40 bg-signal-soft px-2 py-0.5 text-center font-display text-[9px] font-bold uppercase tracking-wider text-signal">
              {b.conditionLabel}
            </span>
            <DownArrow />
            <ActionBox label={b.actionLabel} riskLevel={b.riskLevel} compact />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whether a validation result reads as a pass, a failure, or "nothing to test yet" — drives both the finding box's color and its icon set. Shared by the single-rule and all-rules views so the two always agree on what a given result looks like. */
function validationTone(result: PolicyRuleValidation): "fail" | "inconclusive" | "pass" {
  const untested = result.ok && result.findings[0]?.severity === "info" && result.findings[0]?.message.includes("can't be tested");
  return !result.ok ? "fail" : untested ? "inconclusive" : "pass";
}

/**
 * Renders one validatePolicyRule result: a colored box (reusing the app's
 * existing status vocabulary rather than inventing a fourth — alert/red for
 * a real problem, good/green for a verified pass, caution/amber for
 * "nothing currently matches, so this proved nothing," deliberately not
 * styled as a pass) with one line per finding, since a rule can fail more
 * than one check at once.
 */
export function ValidationFindingsBox({ result }: { result: PolicyRuleValidation }) {
  const tone = validationTone(result);
  return (
    <div
      className={`rounded border px-2.5 py-2 text-[11px] leading-4 ${
        tone === "fail"
          ? "border-alert/40 bg-alert-soft text-alert"
          : tone === "inconclusive"
            ? "border-caution/40 bg-caution-soft text-caution"
            : "border-good/40 bg-good-soft text-good"
      }`}
    >
      <p className="font-display text-[9px] font-bold uppercase tracking-wider">
        {tone === "fail" ? "Logic issue found" : tone === "inconclusive" ? "Nothing to test right now" : "Verified"}
      </p>
      <div className="mt-1.5 space-y-1.5">
        {result.findings.map((finding, i) => (
          <div key={i} className="flex items-start gap-2">
            {finding.severity === "error" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            ) : tone === "inconclusive" ? (
              <Info className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
            )}
            <p className="opacity-90">{finding.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Runs validatePolicyRule on demand (simulates the rule's own action against
 * a real matching record, then cross-checks every other active rule for a
 * genuine order-dependent conflict — see grid-engine.ts for exactly what it
 * checks) and renders the verdict via ValidationFindingsBox above.
 */
function ValidateLogicPanel({
  root,
  actionId,
  ruleId,
  otherRules,
  records,
}: {
  root: QueryNode<StreamRecord>;
  actionId: CinemaActionId;
  /** This rule's own id, if it's already active — lets the conflict check exclude itself from otherRules. Omit for a not-yet-added suggestion. */
  ruleId?: string;
  /** Every other currently active rule, to cross-check for conflicts. */
  otherRules: PolicyRule<StreamRecord, CinemaActionId>[];
  records: StreamRecord[];
}) {
  const [result, setResult] = useState<PolicyRuleValidation | null>(null);

  function runValidation() {
    setResult(validatePolicyRule({ root, actionId, id: ruleId }, records, cinemaDomain.planAction, otherRules));
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <Button size="sm" variant="outline" onClick={runValidation} className="w-full">
        <ShieldCheck className="size-3.5" /> Validate Logic
      </Button>
      {result && (
        <div className="mt-2.5">
          <ValidationFindingsBox result={result} />
        </div>
      )}
    </div>
  );
}

export function FlowchartModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded border border-line-bright bg-panel p-5 shadow-[0_0_40px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-ink">{title}</h4>
          <button type="button" onClick={onClose} className="shrink-0 text-ink-faint hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs leading-5 text-ink-dim">{description}</p>
        {children}
      </div>
    </div>
  );
}

export function PolicyFlowchartModal({
  title,
  description,
  root,
  actionId,
  actionLabel,
  riskLevel,
  ruleId,
  otherRules,
  records,
  onClose,
}: {
  title: string;
  description: string;
  root: QueryNode<StreamRecord>;
  actionId: CinemaActionId;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
  /** This rule's own id, if it's already active — lets the conflict check exclude itself from otherRules. Omit for a not-yet-added suggestion. */
  ruleId?: string;
  /** Every other currently active rule, to cross-check for conflicts. */
  otherRules: PolicyRule<StreamRecord, CinemaActionId>[];
  records: StreamRecord[];
  onClose: () => void;
}) {
  return (
    <FlowchartModalShell title={title} description={description} onClose={onClose}>
      <PolicyFlowchart root={root} actionLabel={actionLabel} riskLevel={riskLevel} />
      <ValidateLogicPanel root={root} actionId={actionId} ruleId={ruleId} otherRules={otherRules} records={records} />
    </FlowchartModalShell>
  );
}

/**
 * The "Check All Rules" button's result: every active rule re-validated
 * against live data AND cross-checked against every other active rule for
 * an order-dependent conflict, all at once — a full simulation of the
 * current rule set rather than one rule at a time.
 */
export function AllRulesCheckModal({
  rules,
  records,
  onClose,
}: {
  rules: PolicyRule<StreamRecord, CinemaActionId>[];
  records: StreamRecord[];
  onClose: () => void;
}) {
  const summaries = rules.map((rule, i) => ({
    ruleNumber: i + 1,
    description: rule.description,
    result: validatePolicyRule({ root: rule.root, actionId: rule.actionId, id: rule.id }, records, cinemaDomain.planAction, rules),
  }));
  const issueCount = summaries.filter((s) => !s.result.ok).length;

  return (
    <FlowchartModalShell
      title="All-Rules Check"
      description={
        issueCount === 0
          ? `Every one of the ${rules.length} active rules was simulated against live data and against every other rule — no dead rules, loop risks, or conflicts found.`
          : `${issueCount} of ${rules.length} active rules have a real problem — simulated against live data and against every other rule.`
      }
      onClose={onClose}
    >
      <div className="max-h-[65vh] space-y-3 overflow-y-auto">
        {summaries.map((s) => (
          <div key={s.ruleNumber}>
            <p className="mb-1 text-xs font-medium leading-5 text-ink">
              <span className="mr-1.5 font-display font-bold text-ink-faint">#{s.ruleNumber}</span>
              {s.description}
            </p>
            <ValidationFindingsBox result={s.result} />
          </div>
        ))}
        {rules.length === 0 && <p className="text-center text-[11px] leading-4 text-ink-faint">No active rules to check.</p>}
      </div>
    </FlowchartModalShell>
  );
}

export function DecisionLadderModal({
  title,
  description,
  triggerLabel,
  branches,
  onClose,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  branches: { conditionLabel: string; actionLabel: string; riskLevel: PolicyRiskLevel }[];
  onClose: () => void;
}) {
  return (
    <FlowchartModalShell title={title} description={description} onClose={onClose}>
      <DecisionLadderFlowchart triggerLabel={triggerLabel} branches={branches} />
    </FlowchartModalShell>
  );
}
