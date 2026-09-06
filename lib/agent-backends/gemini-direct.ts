import { GoogleGenAI } from "@google/genai";
import type { AgentBackend, AgentTurnRequest, AgentTurnResponse } from "./types";
import { runGenAiTurn } from "./genai-shared";

/**
 * Phase 1 backend: calls the public Gemini API directly via @google/genai,
 * using an AI Studio API key. No Google Cloud project, IAM, or Agent Builder
 * involved — this is the fastest path to a working tool-calling loop while
 * the rest of the app is being built.
 */
export function createGeminiDirectBackend(): AgentBackend {
  const apiKey = process.env.GEMINI_API_KEY;
  // Was "gemini-3.5-flash-lite" — its much higher free-tier quota is nice for
  // dev iteration, but confirmed live that it's meaningfully less reliable at
  // knowing when to stop calling tools and just answer: the function-calling
  // loop in agent-chat-panel.tsx would occasionally exhaust its whole turn
  // budget mid-conversation without ever producing final text, even for a
  // single straightforward query. Plain "flash" (not "-lite") is documented
  // as the tier meant for agentic/tool-calling workloads; worth the extra
  // latency/cost for a demo that has to actually finish its turns.
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  return {
    id: "gemini-direct",
    async runTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
      if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
      const ai = new GoogleGenAI({ apiKey });
      return runGenAiTurn(ai, model, request);
    },
  };
}
