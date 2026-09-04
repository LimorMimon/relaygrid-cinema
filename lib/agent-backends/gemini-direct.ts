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
function sanitizeSchemaForGemini(schema: unknown): unknown {
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
    },
  };
}
