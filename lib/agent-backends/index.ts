import type { AgentBackend } from "./types";
import { createGeminiDirectBackend } from "./gemini-direct";
import { createAgentBuilderBackend } from "./agent-builder";

export type { AgentBackend, AgentTurnRequest, AgentTurnResponse, AgentContent, AgentFunctionDeclaration } from "./types";

/** Selects the agent backend from AGENT_BACKEND. Defaults to gemini-direct. */
export function getAgentBackend(): AgentBackend {
  const id = process.env.AGENT_BACKEND || "gemini-direct";
  switch (id) {
    case "gemini-direct":
      return createGeminiDirectBackend();
    case "agent-builder":
      return createAgentBuilderBackend();
    default:
      throw new Error(`Unknown AGENT_BACKEND "${id}". Expected "gemini-direct" or "agent-builder".`);
  }
}
