"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyActionPlan,
  buildActionPlan,
  evaluatePolicyRules,
  explain,
  runQuery,
  validateQuery,
  type PolicyRule,
  type QuerySpec,
  type Transition,
} from "@/lib/grid-engine";
import {
  buildGeminiFunctionDeclarations,
  buildToolSchemas,
  createToolDispatcher,
  type AddPolicyRuleArgs,
  type ToolHandlers,
} from "@/lib/mcp-tools";
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

/**
 * Optional standing-policy support. `resolveRule` is the only domain-specific
 * piece (it knows how to turn loose MCP tool args into a real PolicyRule);
 * everything else here — evaluation, autonomous execution, escalation to a
 * preview — is generic and lives in this hook.
 */
export type PolicyOptions<TRecord, TActionId extends string> = {
  resolveRule: (input: AddPolicyRuleArgs) => PolicyRule<TRecord, TActionId> | { error: string };
  defaultRules?: PolicyRule<TRecord, TActionId>[];
  /** Called on each record an AUTONOMOUS action just changed, so the domain can decide what "auto-resolved" looks like for its own shape (e.g. set a transient status once every flag clears). Return the record unchanged if it doesn't apply. */
  markAutoResolved?: (record: TRecord) => TRecord;
  /** e.g. "⚡ Auto-executed: Restart Audio Encoder for STREAM-CDN-804 via Policy Rule #1." */
  onAutoExecuted?: (message: string) => void;
  /** e.g. "🛎 Policy Rule #3 flagged 2 streams — review the action card to approve." */
  onEscalated?: (message: string) => void;
};

export function useGridAgent<TRecord extends { id: string }, TActionId extends string>(
  domain: DomainConfig<TRecord, TActionId>,
  policyOptions?: PolicyOptions<TRecord, TActionId>,
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
  const [policyRules, setPolicyRules] = useState<PolicyRule<TRecord, TActionId>[]>(policyOptions?.defaultRules ?? []);

  const results = useMemo(() => (query ? runQuery(records, query) : records), [records, query]);
  const visibleBatch = useMemo(() => results.slice(0, domain.batchSize), [results, domain.batchSize]);
  const fieldNames = useMemo(() => new Set(domain.fields.map((f) => f.key)), [domain]);

  const live = useRef({ records, query, results, preview, audit, domain, policyRules });
  useEffect(() => {
    live.current = { records, query, results, preview, audit, domain, policyRules };
  }, [records, query, results, preview, audit, domain, policyRules]);

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
      add_policy_rule: (input) => {
        if (!policyOptions) return reject(input.condition_description ?? "Add policy rule", "This grid does not support policy rules.");
        const resolved = policyOptions.resolveRule(input);
        if ("error" in resolved) return reject(input.condition_description ?? "Add policy rule", resolved.error);
        setPolicyRules((rules) => [...rules, resolved]);
        setAgentNotice(null);
        return {
          ruleId: resolved.id,
          description: resolved.description,
          riskLevel: resolved.riskLevel,
          requestedRiskLevel: input.risk_level,
          riskLevelAdjusted: resolved.riskLevel !== input.risk_level,
        };
      },
    }),
    [fieldNames, reject, policyOptions],
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

  // Continuously evaluate standing policy rules against the live grid.
  // AUTONOMOUS matches execute immediately, through the exact same
  // buildActionPlan/applyActionPlan pipeline manual execution uses.
  // REQUIRES_APPROVAL matches surface as a normal action-card preview —
  // they never bypass the human clicking Approve & Execute.
  useEffect(() => {
    if (policyRules.length === 0) return;

    const autonomousRules = policyRules.filter((r) => r.riskLevel === "AUTONOMOUS");
    const approvalRules = policyRules.filter((r) => r.riskLevel === "REQUIRES_APPROVAL");

    let working = records;
    const auditEntries: AuditEntry<TRecord>[] = [];
    const autoMessages: string[] = [];

    for (const rule of autonomousRules) {
      const ruleNumber = policyRules.indexOf(rule) + 1;
      // Capped to one batch per tick, same as every other action path — any
      // matches beyond that get picked up on the next tick once `records`
      // changes again, rather than one rule mutating the whole grid at once.
      const matched = evaluatePolicyRules(working, [rule])[0].matches.slice(0, domain.batchSize);
      if (matched.length === 0) continue;
      const plan = buildActionPlan(matched, [rule.actionId], domain.planAction);
      const changed = plan.filter((steps) => steps.some((step) => step.allowed));
      if (changed.length === 0) continue;

      const before = working;
      working = applyActionPlan(working, plan);
      if (policyOptions?.markAutoResolved) {
        const changedIds = new Set(changed.map((steps) => steps[0].recordId));
        working = working.map((record) => (changedIds.has(record.id) ? policyOptions.markAutoResolved!(record) : record));
      }

      const actionLabel = domain.actions.find((a) => a.id === rule.actionId)?.label ?? String(rule.actionId);
      auditEntries.push({
        id: `audit-policy-${rule.id}-${Date.now()}`,
        label: `${actionLabel} (policy #${ruleNumber}) · ${changed.length} changed · ${plan.length - changed.length} unchanged`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        before,
      });
      autoMessages.push(
        `⚡ Auto-executed: ${actionLabel} for ${changed.map((steps) => steps[0].recordId).join(", ")} via Policy Rule #${ruleNumber} (${rule.description}).`,
      );
    }

    if (auditEntries.length > 0) {
      setRecords(working);
      setAudit((x) => [...auditEntries.reverse(), ...x]);
      autoMessages.forEach((message) => policyOptions?.onAutoExecuted?.(message));
    }

    // Escalate at most one new match per tick, and never clobber a preview
    // that's already pending review (chat-triggered or policy-triggered).
    if (!live.current.preview) {
      for (const rule of approvalRules) {
        const ruleNumber = policyRules.indexOf(rule) + 1;
        const matched = evaluatePolicyRules(working, [rule])[0].matches.slice(0, domain.batchSize);
        if (matched.length === 0) continue;
        const plan = buildActionPlan(matched, [rule.actionId], domain.planAction);
        const changed = plan.filter((steps) => steps.some((step) => step.allowed));
        if (changed.length === 0) continue;

        const p: PreviewState<TRecord, TActionId> = {
          id: `preview-policy-${rule.id}-${Date.now()}`,
          actions: [rule.actionId],
          requestSummary: `Policy Rule #${ruleNumber}: ${rule.description}`,
          plan,
        };
        setPreview(p);
        const actionLabel = domain.actions.find((a) => a.id === rule.actionId)?.label ?? String(rule.actionId);
        policyOptions?.onEscalated?.(
          `🛎 Policy Rule #${ruleNumber} flagged ${changed.length} stream(s) for "${actionLabel}" — review the action card to approve.`,
        );
        break;
      }
    }
    // Re-runs whenever the grid or the active rule set changes; intentionally
    // not re-run on preview/audit alone (read via the `live` ref instead).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, policyRules, domain, policyOptions]);

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
    setPolicyRules(policyOptions?.defaultRules ?? []);
  }, [initial, policyOptions]);

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
    policyRules,
    toolSchemas,
    geminiTools,
    callTool,
    resetSession,
    dismissPreview,
  };
}
