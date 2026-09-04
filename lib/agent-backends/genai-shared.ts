import type { GoogleGenAI } from "@google/genai";
import type { AgentTurnRequest, AgentTurnResponse } from "./types";

/**
 * Shared between gemini-direct.ts (AI Studio) and agent-builder.ts (Vertex
 * AI) — both call the exact same `generateContent` function-calling loop
 * through @google/genai, and differ only in how the `GoogleGenAI` client
 * itself is constructed (an API key vs. a GCP project + service account).
 * Keeping the retry/sanitize/response-mapping logic in one place means a
 * bug fix or behavior change here never has to be made twice.
 */

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function isTransientOverload(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('"code":503') || message.includes("UNAVAILABLE") || message.includes("high demand");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JsonSchema = Record<string, unknown>;

/**
 * Gemini's function-calling Schema type is a restricted subset of JSON
 * Schema. This app's own domain tools (lib/mcp-tools.ts) already emit
 * Gemini-shaped schemas, but partner MCP servers don't know or care about
 * Gemini — mcp-clickhouse is built on Pydantic, which emits full JSON
 * Schema: Optional[T] becomes `anyOf: [T, {type: "null"}]`, bounded ints
 * carry `exclusiveMinimum`, etc. Gemini's API 400s on some of these
 * outright (confirmed live: "Unknown name \"exclusiveMinimum\"... Cannot
 * find field"). Rather than trust every tool source to already emit a
 * Gemini-shaped schema, sanitize before every request.
 */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (schema === null || typeof schema !== "object") return schema;
  const obj = schema as JsonSchema;

  // Pydantic's Optional[T] shape: anyOf: [T, {type: "null"}] -> T, nullable: true.
  if (Array.isArray(obj.anyOf) && obj.anyOf.length === 2) {
    const branches = obj.anyOf as JsonSchema[];
    const nullBranch = branches.find((b) => b?.type === "null");
    const otherBranch = branches.find((b) => b?.type !== "null");
    if (nullBranch && otherBranch) {
      const { anyOf: _anyOf, ...rest } = obj;
      const merged = sanitizeSchemaForGemini({ ...rest, ...otherBranch }) as JsonSchema;
      return { ...merged, nullable: true };
    }
  }

  // Keys Gemini's function-declaration Schema doesn't recognize and 400s on.
  const UNSUPPORTED_KEYS = new Set([
    "additionalProperties",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "definitions",
    "const",
    "examples",
  ]);
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    result[key] = sanitizeSchemaForGemini(value);
  }
  return result;
}

/**
 * Runs one function-calling turn against an already-constructed GoogleGenAI
 * client, with retry-on-transient-overload — identical whether that client
 * talks to the public Gemini Developer API or to Vertex AI.
 */
export async function runGenAiTurn(ai: GoogleGenAI, model: string, request: AgentTurnRequest): Promise<AgentTurnResponse> {
  const sanitizedTools = request.tools?.map((t) => ({
    ...t,
    parameters: t.parameters ? sanitizeSchemaForGemini(t.parameters) : undefined,
  }));

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
    try {
      const response = await ai.models.generateContent({
        model,
        contents: request.contents as never,
        config: {
          systemInstruction: request.systemInstruction,
          tools: sanitizedTools?.length ? [{ functionDeclarations: sanitizedTools as never }] : undefined,
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
}
