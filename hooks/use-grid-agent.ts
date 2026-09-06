"use client";
/**
 * The React state layer that turns a `DomainConfig` (see lib/domains/*) into
 * a live, agent-controllable grid. This file is domain-agnostic — it never
 * mentions streams, patients, or any other domain shape directly. It wires
 * together, in order:
 *   1. Core grid state (records/query/results/preview/audit) and the six
 *      base MCP tool handlers (describe/apply_query/explain/preview/
 *      execute/undo), built on lib/grid-engine.ts's pure functions.
 *   2. An optional policy-rule engine (`PolicyOptions`) — a useEffect that
 *      continuously evaluates standing rules, auto-executing AUTONOMOUS
 *      matches and raising REQUIRES_APPROVAL matches as a normal preview
 *      the human must click through. The domain supplies rule resolution;
 *      this file supplies the evaluation loop and safety semantics.
 *   3. An optional reporting engine (`ReportingOptions`) — read-only
 *      aggregation over records + the audit trail.
 *   4. A demo-only `injectIncident` escape hatch (see lib/domains/cinema.ts's
 *      injectRandomIncident) for proving the policy loop above reacts to
 *      genuinely new data, not just what was seeded at load.
 * Everything is exposed as native WebMCP tools (document.modelContext) and
 * as a `callTool`/`geminiTools` pair the in-app Gemini chat panel drives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyActionPlan,
  buildActionPlan,
  evaluatePolicyRules,
  explain,
  runQuery,
  validatePolicyRule,
  validateQuery,
  type AuditEntry,
  type PolicyRule,
  type PolicySuggestion,
  type QuerySpec,
  type ReportResult,
  type ReportSpec,
  type Transition,
} from "@/lib/grid-engine";
import {
  buildGeminiFunctionDeclarations,
  buildToolSchemas,
  createToolDispatcher,
  type AddPolicyRuleArgs,
  type AddSuggestedPolicyRuleArgs,
  type GenerateReportArgs,
  type ToolHandlers,
} from "@/lib/mcp-tools";
import type { DomainConfig } from "@/lib/domains/types";
import { ingestSponsorEventRemote, publishSponsorEvent } from "@/lib/sponsor-event-bus";

export type PreviewState<TRecord, TActionId extends string> = {
  id: string;
  actions: TActionId[];
  requestSummary: string;
  plan: Transition<TRecord, TActionId>[][];
  /** Set only when this preview was raised by a REQUIRES_APPROVAL policy rule, so the UI can highlight which rule is asking for approval. */
  triggeredByRuleId?: string;
};

export type { AuditEntry };

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
  /** Called right after a rule is added (manually via add_policy_rule, or picked from Suggested) ONLY when validatePolicyRule finds a real problem — a dead rule, a loop risk, or a conflict with another active rule. Never fires for a clean rule or an inconclusive "nothing matches yet" result. */
  onRuleWarning?: (message: string) => void;
  /** Called once per individual check validatePolicyRule runs while validating a newly-added rule (own-action check, loop-risk check, then one per other active rule) — a live "what's being checked, and did it pass" trace, regardless of the final outcome. */
  onRuleCheckStep?: (message: string) => void;
  /** Computes candidate rules from real current data, excluding ones already active. Omit to disable the suggestions feature entirely. */
  listSuggestions?: (records: TRecord[], activeRules: PolicyRule<TRecord, TActionId>[]) => PolicySuggestion<TRecord>[];
  /** Turns a suggestion's key into the real (possibly compound-condition) PolicyRule to register — bypasses add_policy_rule's flat metric/operator/threshold schema. */
  resolveSuggestion?: (key: string) => PolicyRule<TRecord, TActionId> | { error: string };
};

/**
 * Optional standing-report support. `resolveReport` is the only
 * domain-specific piece (it knows how to turn loose MCP tool args into a
 * real ReportResult over this domain's records/audit trail).
 */
export type ReportingOptions<TRecord, TActionId extends string> = {
  resolveReport: (
    records: TRecord[],
    audit: AuditEntry<TRecord, TActionId>[],
    input: GenerateReportArgs,
  ) => ReportResult | { error: string };
  /** Reports seeded as already-Active for every new session, same role as PolicyOptions.defaultRules. */
  defaultSpecs?: ReportSpec[];
};

export function useGridAgent<TRecord extends { id: string }, TActionId extends string>(
  domain: DomainConfig<TRecord, TActionId>,
  policyOptions?: PolicyOptions<TRecord, TActionId>,
  reportingOptions?: ReportingOptions<TRecord, TActionId>,
) {
  const [initial] = useState<TRecord[]>(() => domain.generateRecords());
  const [records, setRecords] = useState<TRecord[]>(initial);
  const [query, setQuery] = useState<QuerySpec<TRecord> | null>(null);
  const [queryHistory, setQueryHistory] = useState<QuerySpec<TRecord>[]>([]);
  // A list, not a single slot: several REQUIRES_APPROVAL matches — from the
  // policy loop, or a chat-requested preview_action — can be pending review
  // at once. Each is keyed by its own id, approved/dismissed independently.
  const [previews, setPreviews] = useState<PreviewState<TRecord, TActionId>[]>([]);
  const [audit, setAudit] = useState<AuditEntry<TRecord, TActionId>[]>([]);
  const [selected, setSelected] = useState<TRecord | null>(null);
  const [agentNotice, setAgentNotice] = useState<AgentNotice | null>(null);
  const [webmcpReady, setWebmcpReady] = useState(false);
  const [policyRules, setPolicyRules] = useState<PolicyRule<TRecord, TActionId>[]>(policyOptions?.defaultRules ?? []);
  const [reports, setReports] = useState<ReportResult[]>([]);
  const [savedReportSpecs, setSavedReportSpecs] = useState<ReportSpec[]>(reportingOptions?.defaultSpecs ?? []);
  // Whichever record ids a human-approved execution or an autonomous policy
  // rule *just* changed — a transient "look here" signal for the grid UI,
  // separate from the permanent per-record status. Self-clears below.
  const [recentlyChangedIds, setRecentlyChangedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (recentlyChangedIds.size === 0) return;
    const timer = setTimeout(() => setRecentlyChangedIds(new Set()), 4500);
    return () => clearTimeout(timer);
  }, [recentlyChangedIds]);

  const results = useMemo(() => (query ? runQuery(records, query) : records), [records, query]);
  // While a "just changed" flash is active (recentlyChangedIds above),
  // pin those specific records to the front of the visible batch — a stable
  // partition, not a real sort — so a batch action's full effect is visible
  // together even when some of the affected records would otherwise have
  // been outside the first `batchSize` rows. Reverts to natural order the
  // moment the flash clears.
  const visibleBatch = useMemo(() => {
    if (recentlyChangedIds.size === 0) return results.slice(0, domain.batchSize);
    const changed: TRecord[] = [];
    const rest: TRecord[] = [];
    for (const record of results) {
      (recentlyChangedIds.has(record.id) ? changed : rest).push(record);
    }
    return [...changed, ...rest].slice(0, domain.batchSize);
  }, [results, domain.batchSize, recentlyChangedIds]);
  const fieldNames = useMemo(() => new Set(domain.fields.map((f) => f.key)), [domain]);

  // Assigned directly during render, not in a useEffect — an effect only
  // fires after the commit that produced these values, so any tool handler
  // it feeds (execute_action, callTool, ...) could read a ref that's one
  // commit behind whatever's actually on screen if it runs in that window
  // (confirmed live: a click landing there made execute_action's preview
  // lookup fail silently — reject() catches into callTool's `ok: false`,
  // logged with console.error and nothing else, so the card just didn't
  // close on the first click). Writing a "latest values" ref straight in
  // the render body has no such gap — this render's values are in place
  // before this render's JSX (and therefore any click on it) can exist.
  const live = useRef({ records, query, results, previews, audit, domain, policyRules });
  live.current = { records, query, results, previews, audit, domain, policyRules };

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
        // Only drop the ad-hoc chat-requested preview (its plan/batch is tied
        // to the query that's about to change) — policy-escalated previews
        // don't depend on the active filter, so they stay pending.
        setPreviews((prev) => prev.filter((p) => p.triggeredByRuleId !== undefined));
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
        // Same dedup the background policy-escalation loop already applies
        // (see alreadyPendingIds below) — a record with an unrelated pending
        // preview (e.g. from a policy rule) is skipped here too, so a chat
        // request never creates a second, overlapping card for it.
        const alreadyPendingIds = new Set(s.previews.flatMap((p) => p.plan.map((steps) => steps[0]?.recordId)));
        const currentBatch = s.results.filter((r) => !alreadyPendingIds.has(r.id)).slice(0, s.domain.batchSize);
        if (currentBatch.length === 0) {
          return reject(
            input.requestSummary,
            s.results.length > 0
              ? "Every matching record already has a pending action awaiting approval — review the existing action card instead of creating a duplicate."
              : "The active filter has no matching records in the current visible batch.",
          );
        }
        const plan = buildActionPlan(currentBatch, input.actions, s.domain.planAction);
        const p: PreviewState<TRecord, TActionId> = {
          id: `preview-${Date.now()}`,
          actions: input.actions,
          requestSummary: input.requestSummary,
          plan,
        };
        setPreviews((prev) => [...prev, p]);
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
        const target = s.previews.find((p) => p.id === input.previewId);
        if (!target) {
          return reject("Execute action", "Preview is missing or stale. Create a new preview before execution.");
        }
        if (!input.humanConfirmed) {
          return reject("Execute action", "Explicit human confirmation is required before execution.");
        }
        const before = s.records;
        const nextRecords = applyActionPlan(s.records, target.plan);
        setRecords(nextRecords);
        const changedSteps = target.plan.filter((steps) => steps.some((step) => step.allowed));
        const changed = changedSteps.length;
        const changedIds = changedSteps.map((steps) => steps[0].recordId);
        const actionLabels = target.actions
          .map((id) => s.domain.actions.find((a) => a.id === id)?.label ?? id)
          .join(" + ");
        setAudit((x) => [
          {
            id: `audit-${Date.now()}`,
            label: `${actionLabels} · ${changed} changed · ${target.plan.length - changed} unchanged`,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            timestamp: Date.now(),
            before,
            changedRecordIds: changedIds,
            actionIds: target.actions,
            source: "human",
          },
          ...x,
        ]);
        setRecentlyChangedIds(new Set(changedIds));
        setPreviews((prev) => prev.filter((p) => p.id !== target.id));
        setAgentNotice(null);
        if (changed > 0) {
          ingestSponsorEventRemote(
            publishSponsorEvent({
              kind: "action_executed",
              source: "human",
              summary: `${actionLabels} · ${changed} changed · ${target.plan.length - changed} unchanged`,
              payload: {
                actions: target.actions,
                requestSummary: target.requestSummary,
                recordIds: changedIds,
                changed,
                unchanged: target.plan.length - changed,
                approvedBy: "human",
              },
            }),
          );
        }
        return {
          actions: target.actions,
          changed,
          unchanged: target.plan.length - changed,
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
        const s = live.current;
        setPolicyRules((rules) => [...rules, resolved]);
        setAgentNotice(null);
        const ruleNumber = s.policyRules.length + 1;
        policyOptions.onRuleCheckStep?.(`Validating Policy Rule #${ruleNumber} ("${resolved.description}")…`);
        const validation = validatePolicyRule(
          { root: resolved.root, actionId: resolved.actionId },
          s.records,
          s.domain.planAction,
          s.policyRules,
          (step) => policyOptions.onRuleCheckStep?.(`${step.label} → ${step.ok ? "OK" : "ISSUE FOUND"}`),
        );
        if (!validation.ok) {
          const problems = validation.findings.filter((f) => f.severity === "error").map((f) => f.message).join(" ");
          policyOptions.onRuleWarning?.(`⚠ Policy Rule #${ruleNumber} ("${resolved.description}") may not behave as expected — ${problems}`);
        }
        ingestSponsorEventRemote(
          publishSponsorEvent({
            kind: "policy_rule_added",
            source: "rule",
            summary: `Policy Rule #${ruleNumber} added: ${resolved.description}`,
            payload: {
              ruleId: resolved.id,
              ruleNumber,
              description: resolved.description,
              riskLevel: resolved.riskLevel,
              actionId: resolved.actionId,
              validationOk: validation.ok,
            },
          }),
        );
        return {
          ruleId: resolved.id,
          description: resolved.description,
          riskLevel: resolved.riskLevel,
          requestedRiskLevel: input.risk_level,
          riskLevelAdjusted: resolved.riskLevel !== input.risk_level,
          validationOk: validation.ok,
        };
      },
      suggest_policy_rules: () => {
        if (!policyOptions?.listSuggestions) return reject("Suggest policy rules", "This grid does not support rule suggestions.");
        const s = live.current;
        const suggestions = policyOptions.listSuggestions(s.records, s.policyRules);
        setAgentNotice(null);
        return { suggestions };
      },
      add_suggested_policy_rule: (input) => {
        if (!policyOptions?.resolveSuggestion) return reject(input.suggestion_key, "This grid does not support rule suggestions.");
        const resolved = policyOptions.resolveSuggestion(input.suggestion_key);
        if ("error" in resolved) return reject(input.suggestion_key, resolved.error);
        const s = live.current;
        const nextRules = [...s.policyRules, resolved];
        setPolicyRules(nextRules);
        setAgentNotice(null);
        const ruleNumber = nextRules.length;
        policyOptions.onRuleCheckStep?.(`Validating Policy Rule #${ruleNumber} ("${resolved.description}")…`);
        const validation = validatePolicyRule(
          { root: resolved.root, actionId: resolved.actionId },
          s.records,
          s.domain.planAction,
          s.policyRules,
          (step) => policyOptions.onRuleCheckStep?.(`${step.label} → ${step.ok ? "OK" : "ISSUE FOUND"}`),
        );
        if (!validation.ok) {
          const problems = validation.findings.filter((f) => f.severity === "error").map((f) => f.message).join(" ");
          policyOptions.onRuleWarning?.(`⚠ Policy Rule #${ruleNumber} ("${resolved.description}") may not behave as expected — ${problems}`);
        }
        ingestSponsorEventRemote(
          publishSponsorEvent({
            kind: "policy_rule_added",
            source: "rule",
            summary: `Policy Rule #${ruleNumber} added: ${resolved.description}`,
            payload: {
              ruleId: resolved.id,
              ruleNumber,
              description: resolved.description,
              riskLevel: resolved.riskLevel,
              actionId: resolved.actionId,
              validationOk: validation.ok,
            },
          }),
        );
        // Computed here (not via a separate suggest_policy_rules call) so the caller
        // gets the post-add list without racing React's async state commit.
        const remainingSuggestions = policyOptions.listSuggestions?.(s.records, nextRules) ?? [];
        return {
          ruleId: resolved.id,
          description: resolved.description,
          riskLevel: resolved.riskLevel,
          remainingSuggestions,
          validationOk: validation.ok,
        };
      },
      generate_analytics_report: (input) => {
        if (!reportingOptions) return reject(input.report_title ?? "Generate analytics report", "This grid does not support analytics reports.");
        const s = live.current;
        const result = reportingOptions.resolveReport(s.records, s.audit, input);
        if ("error" in result) return reject(input.report_title ?? "Generate analytics report", result.error);
        setReports((r) => [result, ...r].slice(0, 20));
        if (input.save_report) setSavedReportSpecs((specs) => [result.spec, ...specs]);
        setAgentNotice(null);
        return {
          reportId: result.spec.id,
          title: result.spec.title,
          timeWindow: result.spec.timeWindow,
          groupBy: result.spec.groupBy,
          rows: result.rows,
          total: result.total,
          generatedAt: result.generatedAt,
          saved: input.save_report,
        };
      },
    }),
    [fieldNames, reject, policyOptions, reportingOptions],
  );

  const toolSchemas = useMemo(() => buildToolSchemas(domain), [domain]);
  // execute_action is the one tool that actually mutates data, and it's
  // deliberately withheld from every *discoverable/callable-by-an-agent*
  // surface below — Gemini's function-calling list and native WebMCP
  // registration — even though createToolDispatcher (used by dispatch,
  // below, and by the UI's own "Approve & Execute" button) still knows how
  // to run it. Its only real gate is a client-supplied `humanConfirmed`
  // boolean, which an LLM can simply set itself if the tool is ever on its
  // menu — confirmed live that nothing else stops it. Excluding it here is
  // what actually makes "only a human click can execute" true, rather than
  // just a comment/prompt instruction an injected message could talk Gemini
  // out of.
  const agentVisibleSchemas = useMemo(() => toolSchemas.filter((schema) => schema.name !== "execute_action"), [toolSchemas]);
  const geminiTools = useMemo(() => buildGeminiFunctionDeclarations(agentVisibleSchemas), [agentVisibleSchemas]);
  const dispatch = useMemo(() => createToolDispatcher(handlers), [handlers]);

  // Native WebMCP exposure: any MCP-aware agent browser can discover and call
  // these same tools directly, grounded in this document's live grid state.
  // agentVisibleSchemas (not toolSchemas) for the same reason as geminiTools
  // above — execute_action must never be a tool an external agent can find.
  useEffect(() => {
    if (!document.modelContext) return;
    const controller = new AbortController();
    const tools = agentVisibleSchemas.map((schema) => ({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.inputSchema,
      execute: (input?: unknown) => dispatch(schema.name, input),
    }));
    Promise.all(tools.map((tool) => document.modelContext!.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebmcpReady(true))
      .catch(() => setWebmcpReady(false));
    return () => controller.abort();
  }, [agentVisibleSchemas, dispatch]);

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
    const auditEntries: AuditEntry<TRecord, TActionId>[] = [];
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
        timestamp: Date.now(),
        before,
        changedRecordIds: changed.map((steps) => steps[0].recordId),
        actionIds: [rule.actionId],
        source: "policy",
        policyRuleId: rule.id,
      });
      autoMessages.push(
        `⚡ Auto-executed: ${actionLabel} for ${changed.map((steps) => steps[0].recordId).join(", ")} via Policy Rule #${ruleNumber} (${rule.description}).`,
      );
      ingestSponsorEventRemote(
        publishSponsorEvent({
          kind: "action_executed",
          source: "policy",
          summary: `${actionLabel} (policy #${ruleNumber}) · ${changed.length} changed`,
          payload: {
            actionId: rule.actionId,
            ruleId: rule.id,
            ruleNumber,
            ruleDescription: rule.description,
            recordIds: changed.map((steps) => steps[0].recordId),
            changed: changed.length,
            unchanged: plan.length - changed.length,
            approvedBy: "policy",
          },
        }),
      );
    }

    if (auditEntries.length > 0) {
      setRecords(working);
      setAudit((x) => [...auditEntries.reverse(), ...x]);
      setRecentlyChangedIds(new Set(auditEntries.flatMap((entry) => entry.changedRecordIds)));
      autoMessages.forEach((message) => policyOptions?.onAutoExecuted?.(message));
    }

    // Escalate at most one NEW card per tick — but "new" now means "not
    // already covered by a pending preview," not "no preview exists at all."
    // Several approval cards can be pending together; a record already on
    // one of them is skipped so the same fault never gets a duplicate card
    // on a later tick (e.g. the next Inject Incident click re-runs this
    // effect for an unrelated record and would otherwise re-match it).
    const alreadyPendingIds = new Set(live.current.previews.flatMap((p) => p.plan.map((steps) => steps[0]?.recordId)));
    for (const rule of approvalRules) {
      const ruleNumber = policyRules.indexOf(rule) + 1;
      const matched = evaluatePolicyRules(working, [rule])[0].matches
        .filter((record) => !alreadyPendingIds.has(record.id))
        .slice(0, domain.batchSize);
      if (matched.length === 0) continue;
      const plan = buildActionPlan(matched, [rule.actionId], domain.planAction);
      const changed = plan.filter((steps) => steps.some((step) => step.allowed));
      if (changed.length === 0) continue;

      const p: PreviewState<TRecord, TActionId> = {
        id: `preview-policy-${rule.id}-${Date.now()}`,
        actions: [rule.actionId],
        requestSummary: `Policy Rule #${ruleNumber}: ${rule.description}`,
        plan,
        triggeredByRuleId: rule.id,
      };
      setPreviews((prev) => [...prev, p]);
      const actionLabel = domain.actions.find((a) => a.id === rule.actionId)?.label ?? String(rule.actionId);
      policyOptions?.onEscalated?.(
        `🛎 Policy Rule #${ruleNumber} flagged ${changed.length} stream(s) for "${actionLabel}" — review the action card to approve.`,
      );
      break;
    }
    // Re-runs whenever the grid or the active rule set changes; intentionally
    // not re-run on previews/audit alone (read via the `live` ref instead).
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

  const dismissPreview = useCallback((id: string) => setPreviews((prev) => prev.filter((p) => p.id !== id)), []);

  /**
   * Demo-tooling escape hatch — deliberately NOT an MCP tool. Applies a
   * domain-supplied mutator (e.g. injectRandomIncident) to the live records,
   * so a human can prove the policy effect above reacts to genuinely new
   * data rather than just the seeded dataset. Errors are non-fatal (e.g. no
   * eligible record right now) and simply aren't applied.
   */
  const injectIncident = useCallback(
    (mutate: (records: TRecord[]) => { records: TRecord[]; summary: string; changedId: string } | { error: string }) => {
      const result = mutate(live.current.records);
      if (!("error" in result)) {
        setRecords(result.records);
        setRecentlyChangedIds(new Set([result.changedId]));
        setAgentNotice(null);
      }
      return result;
    },
    [],
  );

  const resetSession = useCallback(() => {
    setRecords(initial);
    setQuery(null);
    setQueryHistory([]);
    setPreviews([]);
    setAudit([]);
    setSelected(null);
    setAgentNotice(null);
    setPolicyRules(policyOptions?.defaultRules ?? []);
    setReports([]);
    setSavedReportSpecs(reportingOptions?.defaultSpecs ?? []);
    setRecentlyChangedIds(new Set());
  }, [initial, policyOptions, reportingOptions]);

  return {
    records,
    results,
    visibleBatch,
    query,
    queryHistory,
    previews,
    audit,
    selected,
    setSelected,
    agentNotice,
    webmcpReady,
    policyRules,
    reports,
    savedReportSpecs,
    recentlyChangedIds,
    toolSchemas,
    geminiTools,
    callTool,
    resetSession,
    dismissPreview,
    injectIncident,
  };
}
