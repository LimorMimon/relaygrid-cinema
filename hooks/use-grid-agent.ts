"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyActionPlan,
  buildActionPlan,
  explain,
  runQuery,
  validateQuery,
  type QuerySpec,
  type Transition,
} from "@/lib/grid-engine";
import { buildGeminiFunctionDeclarations, buildToolSchemas, createToolDispatcher, type ToolHandlers } from "@/lib/mcp-tools";
import type { DomainConfig } from "@/lib/domains/types";

export type PreviewState<TRecord, TActionId extends string> = {
  id: string;
  actions: TActionId[];
  requestSummary: string;
  plan: Transition<TRecord, TActionId>[][];
};

export type AuditEntry<TRecord> = {
  id: string;
  label: string;
  time: string;
  before: TRecord[];
};

export type AgentNotice = { request: string; message: string };

export function useGridAgent<TRecord extends { id: string }, TActionId extends string>(
  domain: DomainConfig<TRecord, TActionId>,
) {
  const [initial] = useState<TRecord[]>(() => domain.generateRecords());
  const [records, setRecords] = useState<TRecord[]>(initial);
  const [query, setQuery] = useState<QuerySpec<TRecord> | null>(null);
  const [queryHistory, setQueryHistory] = useState<QuerySpec<TRecord>[]>([]);
  const [preview, setPreview] = useState<PreviewState<TRecord, TActionId> | null>(null);
  const [audit, setAudit] = useState<AuditEntry<TRecord>[]>([]);
  const [selected, setSelected] = useState<TRecord | null>(null);
  const [agentNotice, setAgentNotice] = useState<AgentNotice | null>(null);
  const [webmcpReady, setWebmcpReady] = useState(false);

  const results = useMemo(() => (query ? runQuery(records, query) : records), [records, query]);
  const visibleBatch = useMemo(() => results.slice(0, domain.batchSize), [results, domain.batchSize]);
  const fieldNames = useMemo(() => new Set(domain.fields.map((f) => f.key)), [domain]);

  const live = useRef({ records, query, results, preview, audit, domain });
  useEffect(() => {
    live.current = { records, query, results, preview, audit, domain };
  }, [records, query, results, preview, audit, domain]);

  const reject = useCallback((request: string, message: string): never => {
    setAgentNotice({ request, message });
    throw new Error(message);
  }, []);

  const handlers = useMemo<ToolHandlers<TRecord, TActionId>>(
    () => ({
      describe_grid: (input) => {
        const s = live.current;
        const userRequest = input.userRequest ?? "";
        const requestStatus = input.requestStatus ?? "clear";
        if (requestStatus === "unclear") {
          setAgentNotice({
            request: userRequest || "Unrecognized request",
            message: "I couldn't map this request to a safe filter or action. No query or data was changed.",
          });
        }
        return {
          understood: requestStatus !== "unclear",
          noChangesMade: requestStatus === "unclear",
          recordCount: s.records.length,
          currentMatches: s.results.length,
          currentBatchSize: Math.min(s.domain.batchSize, s.results.length),
          batchLimit: s.domain.batchSize,
          currentQuery: s.query,
          fields: s.domain.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, enumValues: f.enumValues })),
          actions: s.domain.actions,
          examplePrompts: s.domain.examplePrompts,
        };
      },
      apply_query: (input) => {
        const s = live.current;
        const q: QuerySpec<TRecord> = { root: input.root, sort: input.sort, requestSummary: input.requestSummary };
        const errors = validateQuery(q, fieldNames);
        if (errors.length) return reject(input.requestSummary ?? "Apply query", `Invalid query: ${errors.join("; ")}`);
        setQuery((current) => {
          if (current) setQueryHistory((h) => [current, ...h].slice(0, 5));
          return q;
        });
        setPreview(null);
        setSelected(null);
        setAgentNotice(null);
        return { matched: runQuery(s.records, q).length, query: q };
      },
      explain_record: (input) => {
        const s = live.current;
        const record = s.records.find((r) => r.id === input.recordId);
        if (!s.query) return reject(`Explain ${input.recordId}`, "Apply a filter before asking why a record matched.");
        if (!record || !s.results.some((r) => r.id === input.recordId)) {
          return reject(`Explain ${input.recordId}`, "That record is not in the current filtered results.");
        }
        setSelected(record);
        setAgentNotice(null);
        return { recordId: input.recordId, matchedBecause: explain(record, s.query.root) };
      },
      preview_action: (input) => {
        const s = live.current;
        if (!s.query) return reject(input.requestSummary, "Apply a filter before previewing an action.");
        const currentBatch = s.results.slice(0, s.domain.batchSize);
        if (currentBatch.length === 0) {
          return reject(input.requestSummary, "The active filter has no matching records in the current visible batch.");
        }
        const plan = buildActionPlan(currentBatch, input.actions, s.domain.planAction);
        const p: PreviewState<TRecord, TActionId> = {
          id: `preview-${Date.now()}`,
          actions: input.actions,
          requestSummary: input.requestSummary,
          plan,
        };
        setPreview(p);
        setAgentNotice(null);
        const changed = plan.filter((steps) => steps.some((step) => step.allowed));
        return {
          id: p.id,
          actions: p.actions,
          requestSummary: p.requestSummary,
          batchSize: plan.length,
          totalMatches: s.results.length,
          recordsChanged: changed.length,
          recordsUnchanged: plan.length - changed.length,
          sample: plan.slice(0, 5).map((steps) => ({
            recordId: steps[0]?.recordId,
            steps: steps.map((step) => ({ action: step.action, allowed: step.allowed, reason: step.reason })),
          })),
        };
      },
      execute_action: (input) => {
        const s = live.current;
        if (!s.preview || s.preview.id !== input.previewId) {
          return reject("Execute action", "Preview is missing or stale. Create a new preview before execution.");
        }
        if (!input.humanConfirmed) {
          return reject("Execute action", "Explicit human confirmation is required before execution.");
        }
        const before = s.records;
        const nextRecords = applyActionPlan(s.records, s.preview.plan);
        setRecords(nextRecords);
        const changed = s.preview.plan.filter((steps) => steps.some((step) => step.allowed)).length;
        const actionLabels = s.preview.actions
          .map((id) => s.domain.actions.find((a) => a.id === id)?.label ?? id)
          .join(" + ");
        setAudit((x) => [
          {
            id: `audit-${Date.now()}`,
            label: `${actionLabels} · ${changed} changed · ${s.preview!.plan.length - changed} unchanged`,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            before,
          },
          ...x,
        ]);
        setPreview(null);
        setAgentNotice(null);
        return {
          actions: s.preview.actions,
          changed,
          unchanged: s.preview.plan.length - changed,
          remainingMatches: s.query ? runQuery(nextRecords, s.query).length : 0,
          auditCreated: true,
        };
      },
      undo_last_action: () => {
        const s = live.current;
        if (!s.audit[0]) return reject("Undo last action", "There is no executed action to undo yet.");
        setRecords(s.audit[0].before);
        setAudit((x) => x.slice(1));
        setAgentNotice(null);
        return { undone: true };
      },
    }),
    [fieldNames, reject],
  );

  const toolSchemas = useMemo(() => buildToolSchemas(domain), [domain]);
  const geminiTools = useMemo(() => buildGeminiFunctionDeclarations(toolSchemas), [toolSchemas]);
  const dispatch = useMemo(() => createToolDispatcher(handlers), [handlers]);

  // Native WebMCP exposure: any MCP-aware agent browser can discover and call
  // these same tools directly, grounded in this document's live grid state.
  useEffect(() => {
    if (!document.modelContext) return;
    const controller = new AbortController();
    const tools = toolSchemas.map((schema) => ({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.inputSchema,
      execute: (input?: unknown) => dispatch(schema.name, input),
    }));
    Promise.all(tools.map((tool) => document.modelContext!.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebmcpReady(true))
      .catch(() => setWebmcpReady(false));
    return () => controller.abort();
  }, [toolSchemas, dispatch]);

  // Used by the in-app Gemini chat panel: same dispatcher, error-safe.
  const callTool = useCallback(
    (name: string, args: unknown): { ok: true; result: unknown } | { ok: false; error: string } => {
      try {
        return { ok: true, result: dispatch(name, args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [dispatch],
  );

  const dismissPreview = useCallback(() => setPreview(null), []);

  const resetSession = useCallback(() => {
    setRecords(initial);
    setQuery(null);
    setQueryHistory([]);
    setPreview(null);
    setAudit([]);
    setSelected(null);
    setAgentNotice(null);
  }, [initial]);

  return {
    records,
    results,
    visibleBatch,
    query,
    queryHistory,
    preview,
    audit,
    selected,
    setSelected,
    agentNotice,
    webmcpReady,
    toolSchemas,
    geminiTools,
    callTool,
    resetSession,
    dismissPreview,
  };
}
