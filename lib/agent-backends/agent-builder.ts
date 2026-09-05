import { GoogleGenAI } from "@google/genai";
import type { AgentBackend, AgentTurnRequest, AgentTurnResponse } from "./types";
import { runGenAiTurn } from "./genai-shared";

/**
 * Google Cloud backend: the exact same function-calling loop as
 * gemini-direct.ts (see genai-shared.ts), but through Vertex AI on a real
 * GCP project instead of an AI Studio API key — this is what makes it
 * "Google Cloud Agent Builder / Gemini Enterprise Agent Platform" usage for
 * the hackathon's runtime-integration requirement (the @google/genai /
 * google-genai package family is explicitly an accepted SDK; the
 * distinguishing factor is `vertexai: true` plus a real project, not a
 * different package). Deliberately NOT a deployed Vertex AI Agent Engine /
 * ADK resource: that model bakes a fixed toolset into the agent at deploy
 * time, whereas this app sends a different tool list on every request
 * (each domain's own MCP tools, per lib/mcp-tools.ts) — a raw Vertex
 * generateContent call keeps that fully dynamic, same as gemini-direct.ts.
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS_JSON holds the *entire contents* of
 * a service account key file, as one line — not a file path, since
 * Vercel's filesystem isn't a place to keep a secret file. That service
 * account (or, for local dev via `gcloud auth application-default login`,
 * the Google account authenticating) needs the "Agent Platform User" IAM
 * role on GOOGLE_CLOUD_PROJECT.
 *
 * Location defaults to "global", not a region: confirmed live that newer
 * Gemini models 404 ("Publisher Model ... was not found") on regional
 * Vertex endpoints like us-central1 and are only reachable via "global".
 */
export function createAgentBuilderBackend(): AgentBackend {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  return {
    id: "agent-builder",
    async runTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
      if (!project) {
        throw new Error("GOOGLE_CLOUD_PROJECT is not configured on the server (see .env.local.example).");
      }
      let credentials: unknown;
      if (credentialsJson) {
        try {
          credentials = JSON.parse(credentialsJson);
        } catch {
          throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON — paste the full key file contents as one line.");
        }
      }
      // Falls back to Application Default Credentials (e.g. `gcloud auth
      // application-default login` locally) when no explicit key is set.
      const ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        googleAuthOptions: credentials ? ({ credentials } as never) : undefined,
      });
      return runGenAiTurn(ai, model, request);
    },
  };
}
