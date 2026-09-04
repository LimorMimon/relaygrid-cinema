import type { AgentBackend, AgentTurnRequest, AgentTurnResponse } from "./types";

/**
 * NOT YET IMPLEMENTED.
 *
 * Intended Phase 2 backend: run this same tool-calling loop through Google
 * Cloud's Gemini Enterprise Agent Platform / Agent Builder instead of a bare
 * @google/genai call — i.e. create/reuse an Agent Builder app (Vertex AI
 * Discovery Engine "Agent" resource) for this project, register
 * lib/mcp-tools.ts's schemas as its tool/action set (directly, or by
 * fronting them with a managed MCP server), and call its session/query API
 * here instead of GoogleGenAI.models.generateContent.
 *
 * Config this will need once implemented: GOOGLE_CLOUD_PROJECT,
 * GOOGLE_CLOUD_LOCATION, AGENT_BUILDER_APP_ID, and application-default
 * credentials or a service account (IAM), rather than a single API key.
 *
 * The point of `AgentBackend` is that nothing else in the app — the route,
 * the browser chat loop, or the domain/MCP layer — needs to change to swap
 * this in; only AGENT_BACKEND and this file.
 */
export function createAgentBuilderBackend(): AgentBackend {
  return {
    id: "agent-builder",
    async runTurn(_request: AgentTurnRequest): Promise<AgentTurnResponse> {
      throw new Error(
        "The Google Cloud Agent Builder backend is not implemented yet. Set AGENT_BACKEND=gemini-direct to use the direct Gemini API backend.",
      );
    },
  };
}
