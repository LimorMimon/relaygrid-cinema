import { GoogleGenAI } from "@google/genai";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
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
 * Auth has three paths, tried in this order:
 *   1. Workload Identity Federation (the GCP_* vars below) — Vercel's own
 *      OIDC token (`@vercel/oidc`'s getVercelOidcToken()) is exchanged for
 *      short-lived Google credentials via an ExternalAccountClient, letting
 *      the *live, public* Vercel deployment impersonate a real service
 *      account with no service-account key ever created or stored. This is
 *      what actually makes it onto relaygrid-cinema.vercel.app — see
 *      GCP_PROJECT_NUMBER / GCP_SERVICE_ACCOUNT_EMAIL /
 *      GCP_WORKLOAD_IDENTITY_POOL_ID / GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
 *      in .env.local.example for where each value comes from. It exists
 *      specifically because this GCP project's `iam.disableServiceAccountKeyCreation`
 *      org policy blocks path 2 below outright, and Vercel's serverless
 *      environment can't run path 3's `gcloud` login flow.
 *   2. GOOGLE_APPLICATION_CREDENTIALS_JSON — the *entire contents* of a
 *      service account key file, as one line (not a file path, since
 *      Vercel's filesystem isn't a place to keep a secret file). Blocked on
 *      this project by the org policy above; kept as a fallback for GCP
 *      projects that don't have that restriction.
 *   3. Application Default Credentials (`gcloud auth application-default
 *      login`) — local dev only.
 * Whichever path is used, the authenticating identity needs the "Agent
 * Platform User" IAM role on GOOGLE_CLOUD_PROJECT.
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

  const gcpProjectNumber = process.env.GCP_PROJECT_NUMBER;
  const gcpServiceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const gcpPoolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const gcpProviderId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const oidcConfigured = Boolean(gcpProjectNumber && gcpServiceAccountEmail && gcpPoolId && gcpProviderId);

  return {
    id: "agent-builder",
    async runTurn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
      if (!project) {
        throw new Error("GOOGLE_CLOUD_PROJECT is not configured on the server (see .env.local.example).");
      }

      let googleAuthOptions: { authClient?: unknown; projectId?: string; credentials?: unknown } | undefined;
      if (oidcConfigured) {
        // The STS audience below has to be baked into the token's own `aud`
        // claim too, or Google rejects it with "invalid_grant: The audience
        // in ID Token [...] does not match the expected audience" (confirmed
        // live) — getVercelOidcToken()'s default token carries Vercel's own
        // audience (https://vercel.com/<team>), meant for verifying the
        // token was issued for Vercel, not for a specific relying party like
        // this. Passing `audience` here makes Vercel exchange it for one
        // scoped to this WIF provider instead. getSubjectToken is called
        // lazily by the STS exchange inside ExternalAccountClient, never
        // cached here (the token itself says not to cache it).
        const workloadAudience = `//iam.googleapis.com/projects/${gcpProjectNumber}/locations/global/workloadIdentityPools/${gcpPoolId}/providers/${gcpProviderId}`;
        const authClient = ExternalAccountClient.fromJSON({
          type: "external_account",
          audience: workloadAudience,
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          token_url: "https://sts.googleapis.com/v1/token",
          service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${gcpServiceAccountEmail}:generateAccessToken`,
          subject_token_supplier: { getSubjectToken: () => getVercelOidcToken({ audience: workloadAudience }) },
        });
        if (!authClient) {
          throw new Error("Failed to build an ExternalAccountClient from the GCP_* Workload Identity Federation config.");
        }
        googleAuthOptions = { authClient, projectId: project };
      } else if (credentialsJson) {
        let credentials: unknown;
        try {
          credentials = JSON.parse(credentialsJson);
        } catch {
          throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON — paste the full key file contents as one line.");
        }
        googleAuthOptions = { credentials };
      }
      // Otherwise falls back to Application Default Credentials (e.g.
      // `gcloud auth application-default login` locally) when neither the
      // OIDC vars nor an explicit key are set.
      const ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        googleAuthOptions: googleAuthOptions as never,
      });
      return runGenAiTurn(ai, model, request);
    },
  };
}
