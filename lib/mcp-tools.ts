/**
 * Domain-agnostic MCP/WebMCP tool layer.
 *
 * `buildToolSchemas` turns a DomainConfig into the six grid-control tools
 * (describe / query / explain / preview / execute / undo) as plain JSON
 * Schema — the same shape used by document.modelContext.registerTool (the
 * WebMCP browser API) and by the Model Context Protocol generally.
 *
 * `buildGeminiFunctionDeclarations` re-expresses those same schemas in the
 * Gemini function-calling format, so both callers — a real WebMCP-capable
 * browser and our own Gemini-powered chat panel — invoke exactly the same
 * six tools, described from exactly the same source of truth.
 *
 * `createToolDispatcher` wires either caller's {name, args} call to a
 * concrete handler implementation supplied by the UI layer.
 */
import { Type } from "@google/genai";
import type { DomainConfig } from "@/lib/domains/types";
import type { QueryNode, QuerySpec, SortSpec } from "@/lib/grid-engine";

export type McpToolName =
  | "describe_grid"
  | "apply_query"
  | "explain_record"
  | "preview_action"
  | "execute_action"
  | "undo_last_action"
  | "add_policy_rule"
  | "suggest_policy_rules"
  | "add_suggested_policy_rule"
  | "generate_analytics_report";

export type JsonSchema = Record<string, unknown>;

export type McpToolSchema = {
  name: McpToolName;
  description: string;
  inputSchema?: JsonSchema;
};

export type GeminiFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: unknown;
};

function queryNodeGrammar(fieldNames: string[]): string {
  return (
    `A query node is one of three shapes, and nodes may nest arbitrarily:\n` +
    `- Condition: {"kind":"condition","field":<one of ${JSON.stringify(fieldNames)}>,"operator":"eq"|"neq"|"gte"|"lte"|"in"|"after"|"before"|"contains","value":<string|number|boolean|string[]>}\n` +
    `- Group: {"kind":"group","operator":"AND"|"OR","children":[<node>, ...]}\n` +
    `- Negation: {"kind":"not","child":<node>}\n` +
    `Example: {"kind":"group","operator":"AND","children":[{"kind":"condition","field":"bitrateMbps","operator":"lte","value":3},{"kind":"not","child":{"kind":"condition","field":"audioStatus","operator":"eq","value":"OK"}}]}`
  );
}

export function buildToolSchemas<TRecord extends { id: string }, TActionId extends string>(
  domain: DomainConfig<TRecord, TActionId>,
): McpToolSchema[] {
  const fieldNames = domain.fields.map((f) => f.key);
  const actionIds = domain.actions.map((a) => a.id);
  const actionSummaries = domain.actions.map((a) => `${a.id} — ${a.description}`).join("; ");

  return [
    {
      name: "describe_grid",
      description:
        `Describe the ${domain.name} grid and safe usage. If the user's text is gibberish, ambiguous, or not a ` +
        `supported grid request, call this with requestStatus="unclear"; do not invent a query or action. Returns ` +
        `the current record/match counts, available fields, actions, and example prompts.`,
      inputSchema: {
        type: "object",
        properties: {
          userRequest: { type: "string" },
          requestStatus: { type: "string", enum: ["clear", "unclear"] },
        },
      },
    },
    {
      name: "apply_query",
      description:
        `Apply a deterministic filter (and optional sort) to the visible ${domain.recordLabel} grid. Supports ` +
        `nested AND, OR, and NOT. Include requestSummary mirroring the user's intent. ${queryNodeGrammar(fieldNames)}`,
      inputSchema: {
        type: "object",
        properties: {
          requestSummary: { type: "string" },
          root: { type: "object", description: `A recursive query node. ${queryNodeGrammar(fieldNames)}` },
          sort: {
            type: "array",
            items: {
              type: "object",
              properties: { field: { type: "string", enum: fieldNames }, direction: { type: "string", enum: ["asc", "desc"] } },
              required: ["field", "direction"],
            },
          },
        },
        required: ["requestSummary", "root"],
      },
    },
    {
      name: "explain_record",
      description: `Explain why one visible ${domain.recordLabel} matched the active query. Requires an active query.`,
      inputSchema: {
        type: "object",
        properties: { recordId: { type: "string" } },
        required: ["recordId"],
      },
    },
    {
      name: "preview_action",
      description:
        `After a query is active, create a non-mutating deterministic plan for one or more actions ` +
        `(${actionSummaries}) applied in order across only the current visible batch (up to ${domain.batchSize} ` +
        `records). Never call before filtering. Returns exact counts of what will and will not change.`,
      inputSchema: {
        type: "object",
        properties: {
          actions: { type: "array", items: { type: "string", enum: actionIds }, minItems: 1 },
          requestSummary: { type: "string" },
        },
        required: ["actions", "requestSummary"],
      },
    },
    {
      name: "execute_action",
      description:
        "Execute a saved preview for the current visible batch only, after explicit human confirmation in the UI.",
      inputSchema: {
        type: "object",
        properties: {
          previewId: { type: "string" },
          humanConfirmed: { type: "boolean" },
        },
        required: ["previewId", "humanConfirmed"],
      },
    },
    {
      name: "undo_last_action",
      description: "Undo the most recently executed batch action. Do not call when audit history is empty.",
    },
    {
      name: "add_policy_rule",
      description:
        `Register a standing policy rule from a natural-language instruction like "always resync audio when it ` +
        `desyncs on a healthy stream" or "auto-fix subtitle drift". The rule is evaluated continuously against ` +
        `every ${domain.recordLabel}. Set risk_level to AUTONOMOUS only for low-risk, easily-reversible fixes the ` +
        `user clearly wants applied without asking each time; use REQUIRES_APPROVAL for anything riskier — note ` +
        `the system may still force REQUIRES_APPROVAL for a given action regardless of what you request, as a ` +
        `safety floor you cannot override. metric_key should be one of: ${fieldNames.join(", ")}. target_action ` +
        `should be one of: ${actionIds.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          condition_description: { type: "string", description: "Short human-readable summary of the rule." },
          metric_key: { type: "string" },
          operator: { type: "string", enum: ["<", ">", "==", "!="] },
          threshold_value: { type: "string" },
          risk_level: { type: "string", enum: ["AUTONOMOUS", "REQUIRES_APPROVAL"] },
          target_action: { type: "string", enum: actionIds },
        },
        required: ["metric_key", "operator", "threshold_value", "risk_level", "target_action"],
      },
    },
    {
      name: "suggest_policy_rules",
      description:
        `Propose a short list of candidate standing policy rules this ${domain.name} grid does not already have, computed ` +
        `from real current data (never invented) — each includes a live count of how many ${domain.recordLabel}s it would ` +
        `affect right now. This only reads and proposes — it never creates or changes anything, so call it freely, e.g. ` +
        `when the user asks what rules to add or wants automation ideas.`,
    },
    {
      name: "add_suggested_policy_rule",
      description:
        "Register one of the candidates previously returned by suggest_policy_rules as a real, active policy rule, using " +
        "its suggestion_key. Always call suggest_policy_rules first to get a valid key — never guess one.",
      inputSchema: {
        type: "object",
        properties: {
          suggestion_key: { type: "string" },
        },
        required: ["suggestion_key"],
      },
    },
    {
      name: "generate_analytics_report",
      description:
        `Build an aggregate report over ${domain.recordLabel} data from a natural-language request like "show me ` +
        `audio issues by CDN provider over the last 24 hours". This only reads and summarizes data — it never ` +
        `changes anything, so you may call it freely. Set save_report=true when the user implies they want to ` +
        `keep or revisit this report (e.g. "save this", "track this going forward"); otherwise leave it false for ` +
        `a one-off answer. filter_metric should be one of: ${fieldNames.join(", ")}, auto_remediation_count. ` +
        `group_by should be one of: ${fieldNames.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          report_title: { type: "string" },
          time_window: { type: "string", enum: ["1h", "24h", "7d", "all"] },
          filter_metric: { type: "string" },
          group_by: { type: "string" },
          save_report: { type: "boolean" },
        },
        required: ["report_title", "time_window", "filter_metric", "group_by", "save_report"],
      },
    },
  ];
}

function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const typeMap: Record<string, unknown> = {
    object: Type.OBJECT,
    string: Type.STRING,
    array: Type.ARRAY,
    boolean: Type.BOOLEAN,
    number: Type.NUMBER,
    integer: Type.INTEGER,
  };
  const out: Record<string, unknown> = {};
  const type = schema.type as string | undefined;
  if (type) out.type = typeMap[type] ?? Type.STRING;
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.minItems !== undefined) out.minItems = schema.minItems;
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, JsonSchema>).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (schema.items) out.items = toGeminiSchema(schema.items as JsonSchema);
  if (schema.required) out.required = schema.required;
  return out;
}

export function buildGeminiFunctionDeclarations(schemas: McpToolSchema[]): GeminiFunctionDeclaration[] {
  return schemas.map((schema) => ({
    name: schema.name,
    description: schema.description,
    parameters: schema.inputSchema ? toGeminiSchema(schema.inputSchema) : undefined,
  }));
}

export type AddPolicyRuleArgs = {
  condition_description?: string;
  metric_key: string;
  operator: string;
  threshold_value: string | number;
  risk_level: string;
  target_action: string;
};

export type AddSuggestedPolicyRuleArgs = {
  suggestion_key: string;
};

export type GenerateReportArgs = {
  report_title: string;
  time_window: string;
  filter_metric: string;
  group_by: string;
  save_report: boolean;
  /** Not part of Gemini's function-calling schema (see the tool's JSON schema below) — only the app itself sets this, when running a catalog suggestion or a seeded default, so the "why" survives onto the saved ReportSpec. */
  report_rationale?: string;
};

export type ToolHandlers<TRecord extends { id: string }, TActionId extends string> = {
  describe_grid: (input: { userRequest?: string; requestStatus?: "clear" | "unclear" }) => unknown;
  apply_query: (input: { requestSummary?: string; root: QueryNode<TRecord>; sort?: SortSpec<TRecord>[] } & QuerySpec<TRecord>) => unknown;
  explain_record: (input: { recordId: string }) => unknown;
  preview_action: (input: { actions: TActionId[]; requestSummary: string }) => unknown;
  execute_action: (input: { previewId: string; humanConfirmed?: boolean }) => unknown;
  undo_last_action: () => unknown;
  add_policy_rule: (input: AddPolicyRuleArgs) => unknown;
  suggest_policy_rules: () => unknown;
  add_suggested_policy_rule: (input: AddSuggestedPolicyRuleArgs) => unknown;
  generate_analytics_report: (input: GenerateReportArgs) => unknown;
};

export function createToolDispatcher<TRecord extends { id: string }, TActionId extends string>(
  handlers: ToolHandlers<TRecord, TActionId>,
) {
  return (name: string, rawArgs: unknown): unknown => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    switch (name as McpToolName) {
      case "describe_grid":
        return handlers.describe_grid(args);
      case "apply_query":
        return handlers.apply_query(args as never);
      case "explain_record":
        return handlers.explain_record(args as never);
      case "preview_action":
        return handlers.preview_action(args as never);
      case "execute_action":
        return handlers.execute_action(args as never);
      case "undo_last_action":
        return handlers.undo_last_action();
      case "add_policy_rule":
        return handlers.add_policy_rule(args as never);
      case "suggest_policy_rules":
        return handlers.suggest_policy_rules();
      case "add_suggested_policy_rule":
        return handlers.add_suggested_policy_rule(args as never);
      case "generate_analytics_report":
        return handlers.generate_analytics_report(args as never);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
