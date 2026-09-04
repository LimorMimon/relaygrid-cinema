import { GoogleGenAI } from "@google/genai";
import type { AgentBackend, AgentTurnRequest, AgentTurnResponse } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function isTransientOverload(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":503') || message.includes("UNAVAILABLE") || message.includes("high demand");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
        try {
          const response = await ai.models.generateContent({
            model,
            contents: request.contents as never,
            config: {
              systemInstruction: request.systemInstruction,
              tools: request.tools?.length ? [{ functionDeclarations: request.tools as never }] : undefined,
            },
          });

          const candidate = response.candidates?.[0];
          return {
            content: (candidate?.content as AgentTurnResponse["content"]) ?? null,
            text: response.text ?? null,
            functionCalls: (response.functionCalls ?? []).flatMap((call) =>
              call.name ? [{ name: call.name, args: call.args as Record<string, unknown> | undefined }] : [],
            ),
          };
        } catch (error) {
          lastError = error;
          if (!isTransientOverload(error)) throw error;
          // Otherwise: transient upstream overload (503) — retry with backoff.
        }
      }
      throw lastError;
    },
  };
}
