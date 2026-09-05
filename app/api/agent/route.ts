import { getAgentBackend, type AgentContent, type AgentFunctionDeclaration, type AgentTurnResponse } from "@/lib/agent-backends";
import { getPartnerMcpClients, type PartnerMcpClient } from "@/lib/partner-mcp";

export const runtime = "nodejs";

// Safety bound on the server-side partner-tool resolution loop below —
// matches the client's own MAX_TURNS order of magnitude (agent-chat-panel.tsx).
const MAX_PARTNER_TURNS = 4;

/**
 * Stateless agent relay, with one exception: partner-track tool calls (e.g.
 * ClickHouse) are resolved right here, server-side, because they need real
 * credentials the browser must never see (see lib/partner-mcp.ts). Every
 * other tool call still belongs to the browser: it owns the conversation
 * history and the live grid state, sends both plus the domain's own tool
 * declarations on every turn, executes any non-partner functionCall locally
 * against the real grid, and posts the functionResponse back here to
 * continue the loop.
 *
 * To keep the browser (and hooks/use-grid-agent.ts) entirely unaware a
 * partner is involved, this route transparently loops: merge every
 * configured partner's tools (PARTNER_MCP may name more than one) onto
 * whatever the browser sent, call the model, and if EVERY functionCall in
 * that response belongs to some partner, resolve them all here — each
 * dispatched to whichever client actually owns that tool name — and call
 * the model again, repeating until the model either answers in text or asks
 * for a grid tool. A response that mixes partner and grid tool calls in the
 * same turn is handed back to the browser untouched (rare in practice;
 * safer than guessing which half to resolve).
 *
 * One partner failing to list its tools (bad credentials, subprocess
 * crash) never blocks the others or the chat turn overall — it's just
 * missing from mergedTools for that turn, logged server-side.
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
    const partners = getPartnerMcpClients();

    // Which client owns each tool name, so a functionCall can be dispatched
    // back to the right one below. Built per-partner so one's listTools()
    // failure only costs that partner's tools, not the whole merge.
    const toolOwner = new Map<string, PartnerMcpClient>();
    const partnerToolDecls: AgentFunctionDeclaration[] = [];
    await Promise.all(
      partners.map(async (partner) => {
        try {
          const partnerTools = await partner.listTools();
          for (const t of partnerTools) {
            toolOwner.set(t.name, partner);
            partnerToolDecls.push({ name: t.name, description: t.description, parameters: t.inputSchema });
          }
        } catch (error) {
          console.error(`[agent] ${partner.id} listTools failed, continuing without its tools:`, error instanceof Error ? error.message : error);
        }
      }),
    );
    const mergedTools: AgentFunctionDeclaration[] = [...((tools as AgentFunctionDeclaration[] | undefined) ?? []), ...partnerToolDecls];

    let history = contents as AgentContent[];
    let result: AgentTurnResponse = { content: null, text: null, functionCalls: [] };
    for (let turn = 0; turn < MAX_PARTNER_TURNS; turn++) {
      result = await backend.runTurn({ contents: history, tools: mergedTools, systemInstruction });
      if (result.content) history = [...history, result.content];
      if (result.functionCalls.length === 0) break;
      if (!result.functionCalls.every((call) => toolOwner.has(call.name))) break;

      const responseParts = await Promise.all(
        result.functionCalls.map(async (call) => {
          try {
            // Guaranteed present by the .every(toolOwner.has(...)) check above.
            const response = await toolOwner.get(call.name)!.callTool(call.name, call.args ?? {});
            return { functionResponse: { name: call.name, response: response as object } };
          } catch (error) {
            return { functionResponse: { name: call.name, response: { error: error instanceof Error ? error.message : String(error) } } };
          }
        }),
      );
      history = [...history, { role: "user", parts: responseParts }];
    }
    // Included on every response, not just fetched once separately, so a
    // recording of the demo shows each individual answer tagged with the
    // backend that actually produced it — not a claim made once at page load.
    return Response.json({ ...result, backend: backend.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent request failed." }, { status: 502 });
  }
}
