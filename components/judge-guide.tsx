"use client";
import { Check, Play, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type GuideStep = {
  title: string;
  prompt?: string;
  expected: string;
};

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: "1 · Trigger the filter",
    prompt: "Show streams with bitrate below 3Mbps or audio/subtitle sync issues in the last 24h.",
    expected: "Gemini calls apply_query via MCP. The grid updates live to the matching streams, including STREAM-CDN-804.",
  },
  {
    title: "2 · Verify the flagged stream",
    prompt: "Explain why STREAM-CDN-804 matched, and summarize its issues.",
    expected: "Gemini calls explain_record; STREAM-CDN-804 is highlighted (2.4 Mbps on EU-West, audio desync, subtitles out of sync).",
  },
  {
    title: "3 · Preview the remediation",
    prompt: "Prepare an action to switch STREAM-CDN-804 to its failover CDN and restart the audio encoder.",
    expected: "Gemini calls preview_action. An MCP Action Preview card appears — no changes are made yet.",
  },
  {
    title: "4 · Human confirmation",
    expected: 'Click "Approve & Execute" on the card. The grid updates STREAM-CDN-804 to Healthy / Rerouted live.',
  },
];

export function JudgeGuide({
  completedSteps,
  onSend,
  onReset,
  onAutoRun,
  autoRunning,
}: {
  completedSteps: number;
  onSend: (prompt: string) => void;
  onReset: () => void;
  onAutoRun: () => void;
  autoRunning: boolean;
}) {
  return (
    <section className="shrink-0 overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-panel-2 px-4 py-3">
        <div>
          <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Judge Demo Guide</h3>
          <p className="mt-0.5 text-[11px] text-ink-dim">The headline scenario, step by step.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge className="border-signal/40 bg-signal-soft text-signal">
            {completedSteps}/{GUIDE_STEPS.length}
          </Badge>
          <button
            title="Reset the demo session"
            onClick={onReset}
            disabled={autoRunning}
            className="rounded border border-line-bright bg-panel p-1.5 text-ink-dim hover:border-signal hover:text-signal disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="border-b border-line px-3 py-2.5">
        <Button
          size="sm"
          onClick={onAutoRun}
          disabled={autoRunning}
          className="w-full"
          title="Runs steps 1-3 automatically, then stops and waits for you to click Approve & Execute on the action card."
        >
          <Play className="size-3.5" />
          {autoRunning ? "Running steps 1-3…" : "Run full scenario"}
        </Button>
      </div>
      <ol className="divide-y divide-line">
        {GUIDE_STEPS.map((step, i) => {
          const complete = i < completedSteps;
          const active = i === completedSteps;
          return (
            <li
              key={step.title}
              className={
                active
                  ? "border-l-2 border-signal bg-signal-soft/60 p-3"
                  : "border-l-2 border-transparent px-3 py-2"
              }
            >
              <div className="flex items-start gap-2">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full font-display text-[11px] font-bold ${
                    complete
                      ? "bg-signal text-void"
                      : active
                        ? "border border-signal text-signal"
                        : "border border-line-bright text-ink-faint"
                  }`}
                >
                  {complete ? <Check className="size-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <strong className={`block font-display text-[11px] font-bold uppercase tracking-wide leading-5 ${active ? "text-signal" : "text-ink-dim"}`}>
                    {step.title}
                  </strong>
                  {active && (
                    <div className="mt-2">
                      {step.prompt ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mb-2 h-auto w-full whitespace-normal py-1.5 leading-4"
                            onClick={() => onSend(step.prompt!)}
                            disabled={autoRunning}
                          >
                            <Send className="size-3.5" /> Send to chat
                          </Button>
                          <p className="cursor-text select-text font-display text-xs leading-5 text-ink">“{step.prompt}”</p>
                        </>
                      ) : (
                        <p className="text-xs font-medium leading-5 text-ink">Use the Approve &amp; Execute button on the action card.</p>
                      )}
                      <p className="mt-2 text-xs font-medium leading-5 text-ink-dim">
                        <strong className="font-display font-bold uppercase tracking-wide text-ink">Expected:</strong> {step.expected}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
