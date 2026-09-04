"use client";
/**
 * Renders a PolicyRule's condition tree as an actual top-to-bottom
 * flowchart (decision gates connected by AND/OR/NOT connectors, ending at
 * the action it triggers) — a visual companion to the text logic lines in
 * policy-rules-panel.tsx. Also renders a genuine if/else: two rules that
 * react to different values of the same field with different actions,
 * shown together as one branching diagram (see DecisionLadderFlowchart).
 */
import { X } from "lucide-react";
import type { QueryNode, PolicyRiskLevel } from "@/lib/grid-engine";
import type { StreamRecord } from "@/lib/domains/cinema";

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

function FlowchartModalShell({
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
  actionLabel,
  riskLevel,
  onClose,
}: {
  title: string;
  description: string;
  root: QueryNode<StreamRecord>;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
  onClose: () => void;
}) {
  return (
    <FlowchartModalShell title={title} description={description} onClose={onClose}>
      <PolicyFlowchart root={root} actionLabel={actionLabel} riskLevel={riskLevel} />
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
