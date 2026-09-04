import { getAgentBackend, type AgentContent, type AgentFunctionDeclaration } from "@/lib/agent-backends";

export const runtime = "nodejs";

/**
 * Stateless agent relay. Knows nothing about any domain, and nothing about
 * which orchestration platform is actually running the model — that's
 * `getAgentBackend()`'s job (see lib/agent-backends). The browser owns the
 * conversation history and the live grid state: it sends both the history
 * and the current tool declarations on every turn, executes any
 * functionCall locally against the real grid, and posts the
 * functionResponse back here to continue the loop.
 */
export async function POST(request: Request) {
  let body: { contents?: unknown; tools?: unknown; systemInstruction?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { contents, tools, systemInstruction } = body;
  if (!Array.isArray(contents) || contents.length === 0) {
    return Response.json({ error: "`contents` must be a non-empty array." }, { status: 400 });
  }

  try {
    const backend = getAgentBackend();
    const result = await backend.runTurn({
      contents: contents as AgentContent[],
      tools: tools as AgentFunctionDeclaration[] | undefined,
      systemInstruction,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent request failed." }, { status: 502 });
  }
}
