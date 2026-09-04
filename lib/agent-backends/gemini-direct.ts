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
  // "-lite" models tend to carry a much higher free-tier daily quota than
  // the full flash/pro models, which matters a lot for iterative dev testing.
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  return {
    id: "gemini-direct",
    async runTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
      if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
      const ai = new GoogleGenAI({ apiKey });
      return runGenAiTurn(ai, model, request);
    },
  };
}
