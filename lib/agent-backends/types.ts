/**
 * The seam between "how we talk to the app's server route" and "which
 * orchestration platform actually runs the model + tool-calling loop".
 *
 * Phase 1 ships one implementation (`gemini-direct.ts`, plain @google/genai).
 * A later phase can add a Google Cloud Agent Builder / Gemini Enterprise
 * Agent Platform implementation of this exact interface — nothing in
 * app/api/agent/route.ts or the browser needs to change when that happens,
 * only which backend `getAgentBackend()` selects.
 */

export type AgentContent = {
  role: "user" | "model";
  parts: Array<{
    text?: string;
    functionCall?: { name: string; args?: Record<string, unknown> };
    functionResponse?: { name: string; response: unknown };
  }>;
};

export type AgentFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: unknown;
};

export type AgentTurnRequest = {
  contents: AgentContent[];
  tools?: AgentFunctionDeclaration[];
  systemInstruction?: string;
};

export type AgentTurnResponse = {
  content: AgentContent | null;
  text: string | null;
  functionCalls: Array<{ name: string; args?: Record<string, unknown> }>;
};

export interface AgentBackend {
  /** Selector value for AGENT_BACKEND, e.g. "gemini-direct" | "agent-builder". */
  id: string;
  runTurn(request: AgentTurnRequest): Promise<AgentTurnResponse>;
}
