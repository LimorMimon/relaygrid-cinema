"use client";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PreviewState } from "@/hooks/use-grid-agent";
import type { CinemaActionId, StreamRecord } from "@/lib/domains/cinema";
import { cinemaDomain } from "@/lib/domains/cinema";

function actionLabel(id: CinemaActionId): string {
  return cinemaDomain.actions.find((a) => a.id === id)?.label ?? id;
}

export function ActionCard({
  preview,
  busy,
  onApprove,
  onDismiss,
}: {
  preview: PreviewState<StreamRecord, CinemaActionId>;
  busy?: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const changed = preview.plan.filter((steps) => steps.some((s) => s.allowed));
  const unchanged = preview.plan.length - changed.length;
  const sample = changed.slice(0, 2);

  return (
    <div className="mb-4 shrink-0 overflow-hidden rounded border border-caution/45 bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-caution/30 bg-caution-soft px-4 py-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-caution" />
          <div>
            <p className="font-display text-[10px] font-extrabold uppercase tracking-widest text-caution">MCP action preview — no changes made</p>
            <p className="mt-1 text-sm font-semibold text-ink">{preview.actions.map(actionLabel).join(" & ")}</p>
          </div>
        </div>
        <Badge className="shrink-0 border-caution/40 bg-void-2 text-caution">{preview.plan.length} streams</Badge>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs leading-5 text-ink-dim">{preview.requestSummary}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-line bg-void-2 px-2 py-1.5 text-ink-dim">
            Will change <strong className="float-right font-display text-signal">{changed.length}</strong>
          </div>
          <div className="rounded border border-line bg-void-2 px-2 py-1.5 text-ink-dim">
            Unchanged <strong className="float-right font-display text-ink-faint">{unchanged}</strong>
          </div>
        </div>
        {sample.length > 0 && (
          // No max-height/scroll here on purpose — `sample` is always at most
          // 2 entries (see the `.slice(0, 2)` above), so the list's natural
          // height is already bounded; a fixed max-h just clipped those two
          // entries into an unnecessary inner scrollbar.
          <ul className="mt-3 space-y-1.5">
            {sample.map((steps) => (
              <li key={steps[0]?.recordId} className="rounded border border-line bg-void-2 px-2.5 py-1.5 text-xs">
                <span className="font-display font-semibold text-signal">{steps[0]?.recordId}</span>
                <ul className="mt-1 space-y-0.5 text-ink-dim">
                  {steps.map((step, i) => (
                    <li key={i}>
                      <span className={step.allowed ? "text-signal" : "text-ink-faint"}>{step.allowed ? "✓" : "—"}</span>{" "}
                      {actionLabel(step.action)}: {step.reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {changed.length > sample.length && (
          <p className="mt-1.5 text-[11px] font-medium text-ink-faint">+ {changed.length - sample.length} more</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={onApprove} disabled={busy || changed.length === 0} className="flex-1">
            {busy ? "Executing…" : "Approve & Execute"}
          </Button>
          <Button size="sm" variant="outline" onClick={onDismiss} disabled={busy}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
