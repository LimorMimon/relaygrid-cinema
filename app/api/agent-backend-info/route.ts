import { getAgentBackend } from "@/lib/agent-backends";

export const runtime = "nodejs";

/**
 * Tells the browser which AgentBackend is actually serving chat turns right
 * now (see lib/agent-backends/index.ts) — driven purely by the server's own
 * AGENT_BACKEND env var, never by anything the client claims. Exists so the
 * header badge in cinema-grid-app.tsx can show "Gemini API" vs. "Vertex AI"
 * truthfully: whichever this app is actually deployed with, not a
 * hardcoded label that could silently drift from reality.
 */
export async function GET() {
  return Response.json({ id: getAgentBackend().id });
}
