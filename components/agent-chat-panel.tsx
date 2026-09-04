"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GeminiFunctionDeclaration } from "@/lib/mcp-tools";

type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

type ChatMessage = { id: string; kind: "user" | "assistant" | "tool" | "error"; text: string };

const MAX_TURNS = 10;

function summarizeToolCall(name: string, args: Record<string, unknown> | undefined, outcome: { ok: true; result: unknown } | { ok: false; error: string }): string {
  if (!outcome.ok) return `${name} → rejected: ${outcome.error}`;
  const r = outcome.result as Record<string, unknown>;
  switch (name) {
    case "apply_query":
      return `apply_query → ${r.matched} matching streams`;
    case "explain_record":
      return `explain_record(${args?.recordId}) → matched ${(r.matchedBecause as unknown[] | undefined)?.length ?? 0} conditions`;
    case "preview_action":
      return `preview_action → ${r.recordsChanged} will change, ${r.recordsUnchanged} unchanged`;
    case "undo_last_action":
      return `undo_last_action → ${r.undone ? "restored previous state" : "nothing to undo"}`;
    case "execute_action":
      return `execute_action → ${r.changed} changed, ${r.unchanged} unchanged`;
    case "describe_grid":
      return "describe_grid → capabilities returned";
    default:
      return `${name} → ok`;
  }
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  kind: "assistant",
  text:
    "Hi — I'm the RelayGrid Cinema copilot, running on Gemini. Ask me to filter streams, explain a match, or prepare a remediation action, and I'll call the grid's MCP tools live.",
};

export type AgentChatPanelHandle = {
  /** Sends each prompt in order, awaiting the full tool-calling loop before the next. */
  runSequence: (prompts: string[]) => Promise<void>;
  /** Clears the chat back to the welcome message and drops Gemini conversation history. */
  resetConversation: () => void;
  /** Logs a tool call the parent made directly (e.g. a UI button), not one Gemini requested. */
  logToolResult: (
    name: string,
    args: Record<string, unknown> | undefined,
    outcome: { ok: true; result: unknown } | { ok: false; error: string },
  ) => void;
};

export const AgentChatPanel = forwardRef<
  AgentChatPanelHandle,
  {
    geminiTools: GeminiFunctionDeclaration[];
    systemInstruction: string;
    callTool: (name: string, args: unknown) => { ok: true; result: unknown } | { ok: false; error: string };
    onToolCall?: (name: string) => void;
    injectedPrompt?: string | null;
    onInjectedPromptConsumed?: () => void;
  }
>(function AgentChatPanel({ geminiTools, systemInstruction, callTool, onToolCall, injectedPrompt, onInjectedPromptConsumed }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const contentsRef = useRef<GeminiContent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (injectedPrompt) {
      void send(injectedPrompt);
      onInjectedPromptConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedPrompt]);

  useImperativeHandle(ref, () => ({
    runSequence: async (prompts: string[]) => {
      for (const prompt of prompts) await send(prompt);
    },
    resetConversation: () => {
      contentsRef.current = [];
      setMessages([WELCOME_MESSAGE]);
    },
    logToolResult: (name, args, outcome) => {
      appendMessage({ kind: "tool", text: summarizeToolCall(name, args, outcome) });
    },
  }));

  function appendMessage(msg: Omit<ChatMessage, "id">) {
    setMessages((m) => [...m, { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    appendMessage({ kind: "user", text });

    let history = [...contentsRef.current, { role: "user" as const, parts: [{ text }] }];
    contentsRef.current = history;
    let gaveFinalAnswer = false;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: history, tools: geminiTools, systemInstruction }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? "Gemini request failed.");

        if (data.content) {
          history = [...history, data.content as GeminiContent];
          contentsRef.current = history;
        }
        const text = typeof data.text === "string" ? data.text.trim() : "";
        if (text) {
          appendMessage({ kind: "assistant", text });
          gaveFinalAnswer = true;
        }

        const calls: Array<{ name: string; args?: Record<string, unknown> }> = data.functionCalls ?? [];
        if (!calls.length) break;

        const responseParts: GeminiPart[] = [];
        for (const call of calls) {
          const outcome = callTool(call.name, call.args ?? {});
          onToolCall?.(call.name);
          appendMessage({ kind: "tool", text: summarizeToolCall(call.name, call.args, outcome) });
          responseParts.push({
            functionResponse: { name: call.name, response: outcome.ok ? (outcome.result as object) : { error: outcome.error } },
          });
        }
        history = [...history, { role: "user", parts: responseParts }];
        contentsRef.current = history;
      }
      if (!gaveFinalAnswer) {
        appendMessage({
          kind: "error",
          text: "Reached the tool-call limit for this turn without a final answer — see the ⚙ log above for what was actually done. Try a more specific follow-up.",
        });
      }
    } catch (error) {
      appendMessage({ kind: "error", text: error instanceof Error ? error.message : "Something went wrong talking to Gemini." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5">
        <Sparkles className="size-3.5 text-signal" />
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-ink">Agent Chat</span>
        <span className="font-display text-xs text-ink-faint">· Gemini</span>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={m.kind === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.kind === "tool" ? (
              <div className="max-w-[92%] rounded border border-line bg-void-2 px-2.5 py-1 font-display text-[11px] text-signal">
                ⚙ {m.text}
              </div>
            ) : m.kind === "error" ? (
              <div className="max-w-[92%] rounded border border-alert/40 bg-alert-soft px-3 py-2 text-xs font-medium text-alert">
                ⚠ {m.text}
              </div>
            ) : (
              <div
                className={`max-w-[92%] whitespace-pre-wrap rounded px-3 py-2 text-sm leading-5 ${
                  m.kind === "user" ? "bg-signal text-void" : "bg-panel-2 text-ink"
                }`}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-1.5 px-1 font-display text-xs text-ink-faint">
            <Loader2 className="size-3.5 animate-spin text-signal" /> Gemini is working…
          </div>
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-line p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about streams, filters, or remediation…"
          disabled={busy}
          className="h-9 flex-1 rounded border border-line-bright bg-void-2 px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-signal disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={busy || !input.trim()}>
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
});
