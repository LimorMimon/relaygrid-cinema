/**
 * Domain-agnostic query/condition engine for RelayGrid.
 *
 * This module knows nothing about medicine or media streaming — it only
 * operates on plain records shaped `{ id: string, ...fields }`. A domain
 * (see lib/domains/*) supplies the record type, the field list, and the
 * available actions; this engine supplies filtering, sorting, explanation,
 * and batch-action planning on top of that.
 */

export type Operator =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "in"
  | "after"
  | "before"
  | "contains";

export type ConditionValue = string | number | boolean | string[];

export type Condition<TRecord> = {
  kind: "condition";
  field: keyof TRecord & string;
  operator: Operator;
  value: ConditionValue;
};

export type QueryNode<TRecord> =
  | Condition<TRecord>
  | { kind: "group"; operator: "AND" | "OR"; children: QueryNode<TRecord>[] }
  | { kind: "not"; child: QueryNode<TRecord> };

export type SortSpec<TRecord> = {
  field: keyof TRecord & string;
  direction: "asc" | "desc";
};

export type QuerySpec<TRecord> = {
  root: QueryNode<TRecord>;
  sort?: SortSpec<TRecord>[];
  requestSummary?: string;
};

function compareValues(actual: unknown, operator: Operator, expected: ConditionValue): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gte":
      return Number(actual) >= Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(String(actual));
    case "contains":
      return typeof actual === "string" && actual.toLowerCase().includes(String(expected).toLowerCase());
    case "after":
      return new Date(String(actual)).getTime() >= new Date(String(expected)).getTime();
    case "before":
      return new Date(String(actual)).getTime() <= new Date(String(expected)).getTime();
    default:
      return false;
  }
}

export function matches<TRecord>(record: TRecord, node: QueryNode<TRecord>): boolean {
  if (node.kind === "condition") {
    return compareValues(record[node.field], node.operator, node.value);
  }
  if (node.kind === "not") return !matches(record, node.child);
  return node.operator === "AND"
    ? node.children.every((child) => matches(record, child))
    : node.children.some((child) => matches(record, child));
}

export function runQuery<TRecord>(records: TRecord[], query: QuerySpec<TRecord>): TRecord[] {
  const filtered = records.filter((record) => matches(record, query.root));
  const sort = query.sort ?? [];
  if (!sort.length) return filtered;
  return [...filtered].sort((a, b) => {
    for (const spec of sort) {
      const av = a[spec.field];
      const bv = b[spec.field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp) return spec.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

export function describeNode<TRecord>(node: QueryNode<TRecord>): string {
  if (node.kind === "condition") {
    const value = Array.isArray(node.value) ? `[${node.value.join(", ")}]` : String(node.value);
    return `${node.field} ${node.operator} ${value}`;
  }
  if (node.kind === "not") return `NOT (${describeNode(node.child)})`;
  return `(${node.children.map(describeNode).join(` ${node.operator} `)})`;
}

/**
 * Like describeNode, but one line per top-level branch instead of a single
 * flattened string — so a genuinely nested rule (multiple AND/OR/NOT
 * branches) visibly reads as multi-line pseudo-code in the UI, while a
 * simple one-condition rule stays exactly one line. Sub-branches within
 * each line still use describeNode's compact parenthesized form.
 */
export function describeNodeLines<TRecord>(node: QueryNode<TRecord>): string[] {
  if (node.kind === "not") return [`NOT (${describeNode(node.child)})`];
  if (node.kind === "group" && node.children.length > 1) {
    return node.children.map((child, i) => (i === 0 ? describeNode(child) : `${node.operator} ${describeNode(child)}`));
  }
  return [describeNode(node)];
}

export function explain<TRecord>(record: TRecord, node: QueryNode<TRecord>): string[] {
  if (node.kind === "condition") return matches(record, node) ? [describeNode(node)] : [];
  if (node.kind === "not") return matches(record, node) ? [`NOT (${describeNode(node.child)})`] : [];
  return node.children.flatMap((child) => explain(record, child));
}

export function validateQuery<TRecord>(
  query: QuerySpec<TRecord>,
  validFields: ReadonlySet<string>,
  validOperators: ReadonlySet<Operator> = new Set([
    "eq",
    "neq",
    "gte",
    "lte",
    "gt",
    "lt",
    "in",
    "after",
    "before",
    "contains",
  ]),
): string[] {
  const errors: string[] = [];
  function walk(node: QueryNode<TRecord> | undefined, path: string) {
    if (!node || typeof node !== "object") {
      errors.push(`${path} must be a query node`);
      return;
    }
    if (node.kind === "condition") {
      if (!validFields.has(node.field)) errors.push(`${path}.field is not supported`);
      if (!validOperators.has(node.operator)) errors.push(`${path}.operator is not supported`);
      if (node.operator === "in" && !Array.isArray(node.value)) {
        errors.push(`${path}.value must be an array for "in"`);
      }
      return;
    }
    if (node.kind === "group") {
      if (node.operator !== "AND" && node.operator !== "OR") errors.push(`${path}.operator must be AND or OR`);
      if (!Array.isArray(node.children) || node.children.length === 0) {
        errors.push(`${path}.children cannot be empty`);
      } else {
        node.children.forEach((child, i) => walk(child, `${path}.children[${i}]`));
      }
      return;
    }
    if (node.kind === "not") {
      walk(node.child, `${path}.child`);
      return;
    }
    errors.push(`${path}.kind is invalid`);
  }
  walk(query?.root, "root");
  for (const [i, spec] of (query?.sort ?? []).entries()) {
    if (!validFields.has(spec.field)) errors.push(`sort[${i}].field is not supported`);
    if (spec.direction !== "asc" && spec.direction !== "desc") errors.push(`sort[${i}].direction is invalid`);
  }
  return errors;
}

/** The outcome of attempting one action on one record. */
export type Transition<TRecord, TActionId extends string> = {
  recordId: string;
  action: TActionId;
  allowed: boolean;
  reason: string;
  /** Fields that will change on the record if this transition is applied. */
  patch: Partial<TRecord>;
};

export type PlanActionFn<TRecord, TActionId extends string> = (
  record: TRecord,
  action: TActionId,
) => Transition<TRecord, TActionId>;

/** Plans one or more actions (applied in order) against every given record. */
export function buildActionPlan<TRecord extends { id: string }, TActionId extends string>(
  records: TRecord[],
  actions: TActionId[],
  planAction: PlanActionFn<TRecord, TActionId>,
): Transition<TRecord, TActionId>[][] {
  return records.map((record) => {
    let working = record;
    const steps: Transition<TRecord, TActionId>[] = [];
    for (const action of actions) {
      const transition = planAction(working, action);
      steps.push(transition);
      if (transition.allowed) working = { ...working, ...transition.patch };
    }
    return steps;
  });
}

export function applyActionPlan<TRecord extends { id: string }, TActionId extends string>(
  records: TRecord[],
  plan: Transition<TRecord, TActionId>[][],
): TRecord[] {
  const patches = new Map<string, Partial<TRecord>>();
  for (const steps of plan) {
    for (const step of steps) {
      if (!step.allowed) continue;
      patches.set(step.recordId, { ...patches.get(step.recordId), ...step.patch });
    }
  }
  return records.map((record) => (patches.has(record.id) ? { ...record, ...patches.get(record.id) } : record));
}

export type PolicyRiskLevel = "AUTONOMOUS" | "REQUIRES_APPROVAL";

/**
 * A standing rule: whenever `root` matches a record, `actionId` should run
 * against it — either immediately (AUTONOMOUS) or only after a human
 * approves a preview (REQUIRES_APPROVAL). Reuses the same QueryNode tree as
 * apply_query, so compound AND/OR conditions work for free.
 */
export type PolicyRule<TRecord, TActionId extends string> = {
  id: string;
  description: string;
  root: QueryNode<TRecord>;
  actionId: TActionId;
  riskLevel: PolicyRiskLevel;
  createdAt: string;
  /** Set when this rule was registered from a catalog suggestion, so it can be excluded from future suggestion lists. */
  sourceKey?: string;
};

/** A candidate rule computed from real current data, not yet registered — the read-only half of the policy-suggestion flow. */
export type PolicySuggestion<TRecord = unknown> = {
  key: string;
  description: string;
  rationale: string;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
  matchCount: number;
  /** The real condition tree — exposed so the UI can render it (as text or a flowchart), not just the English description. */
  root: QueryNode<TRecord>;
  /** The raw action id (not just its label) — needed to run validatePolicyRule before this suggestion is even added. */
  actionId: string;
};

/** Pure evaluation: which records currently match each active policy rule. */
export function evaluatePolicyRules<TRecord extends { id: string }, TActionId extends string>(
  records: TRecord[],
  rules: PolicyRule<TRecord, TActionId>[],
): Array<{ rule: PolicyRule<TRecord, TActionId>; matches: TRecord[] }> {
  return rules.map((rule) => ({ rule, matches: records.filter((record) => matches(record, rule.root)) }));
}

export type PolicyRuleFinding = { severity: "error" | "info"; message: string };
export type PolicyRuleValidation = { ok: boolean; findings: PolicyRuleFinding[] };
/** One line of "what is being checked right now, and did it pass" — reported live as validatePolicyRule works, not just in the final findings. */
export type PolicyRuleCheckStep = { label: string; ok: boolean };

function applyIfMatches<TRecord extends { id: string }, TActionId extends string>(
  record: TRecord,
  step: Pick<PolicyRule<TRecord, TActionId>, "root" | "actionId">,
  planAction: PlanActionFn<TRecord, TActionId>,
): TRecord {
  if (!matches(record, step.root)) return record;
  const transition = planAction(record, step.actionId);
  return transition.allowed ? { ...record, ...transition.patch } : record;
}

/**
 * Simulates one real application of a rule's action against a record it
 * actually matches, then checks it three ways against the domain's own
 * planAction — not a hand-authored list of "known bad patterns":
 *   1. Dead rule — the action's own guard rejects it outright on a real
 *      match (e.g. the target field is already in the state the action
 *      would set it to). The rule can never do anything.
 *   2. Loop risk — the rule's condition tree is STILL true on the record
 *      after applying the action's own patch. This means the trigger
 *      doesn't reference what the action actually resolves, so the rule
 *      keeps re-matching the same records forever (each retry is a safe
 *      no-op once the field the action *does* touch is already fixed —
 *      every action here is itself idempotent — but it's a real sign the
 *      rule's author pointed the condition at the wrong field).
 *   3. Conflicts with each other active rule (`otherRules`) — for every
 *      pair, finds a real record that currently matches both, and checks
 *      whether the order the two rules happen to run in (an implementation
 *      detail, not something either rule's author controls) changes the
 *      outcome. Two runs are simulated, re-checking each rule's own
 *      condition before its step exactly like the live evaluation loop
 *      does: ruleA's action then ruleB's (if ruleB still matches after),
 *      versus ruleB's action then ruleA's (if ruleA still matches after).
 *      If the two orders land on a different final value for any field —
 *      or one order lets both actions fire while the other silently skips
 *      one because the first action already changed what the second was
 *      looking for — the two rules are fighting over that record. This is
 *      discovered empirically by running both orders and diffing the
 *      result, never by guessing from field names.
 * Requires a currently-matching record to test each thing against; can't
 * prove anything about a rule (or a pair) with no live overlap right now.
 * `otherRules` (default none) is every other currently active rule to
 * cross-check against — pass the rule's own id in `rule` so it can exclude
 * itself if it happens to already be in that list. `onStep`, if given, is
 * called once per individual check as it runs (own-action check, loop-risk
 * check, then one per other rule) — the live "what's being checked, and
 * did it pass" trace the UI can narrate as the validation happens.
 */
export function validatePolicyRule<TRecord extends { id: string }, TActionId extends string>(
  rule: Pick<PolicyRule<TRecord, TActionId>, "root" | "actionId"> & { id?: string },
  records: TRecord[],
  planAction: PlanActionFn<TRecord, TActionId>,
  otherRules: PolicyRule<TRecord, TActionId>[] = [],
  onStep?: (step: PolicyRuleCheckStep) => void,
): PolicyRuleValidation {
  const findings: PolicyRuleFinding[] = [];
  const sample = records.find((r) => matches(r, rule.root));

  if (!sample) {
    findings.push({
      severity: "info",
      message: "No stream currently matches this rule's trigger, so it can't be tested against real data right now — try again after the grid changes.",
    });
    onStep?.({ label: "Checking the rule against live data", ok: true });
  } else {
    const transition = planAction(sample, rule.actionId);
    const canRun = transition.allowed;
    onStep?.({ label: `Checking the action can actually run (sample: ${sample.id})`, ok: canRun });
    if (!canRun) {
      findings.push({
        severity: "error",
        message: `Dead rule: on a real matching stream (${sample.id}), the action's own guard rejects it — "${transition.reason}". This rule can never actually do anything.`,
      });
    } else {
      const patched = { ...sample, ...transition.patch };
      const noLoopRisk = !matches(patched, rule.root);
      onStep?.({ label: "Checking the action resolves its own trigger (no loop risk)", ok: noLoopRisk });
      if (!noLoopRisk) {
        findings.push({
          severity: "error",
          message: `Loop risk: after applying its own action to ${sample.id}, the record still matches this rule's trigger. The condition doesn't reference the field the action actually resolves, so it will keep re-matching the same streams every tick indefinitely.`,
        });
      } else {
        findings.push({
          severity: "info",
          message: `Verified against ${sample.id}: applying the action resolves exactly the condition that triggered it — no loop risk, no dead rule.`,
        });
      }
    }
  }

  for (let i = 0; i < otherRules.length; i++) {
    const other = otherRules[i];
    if (rule.id && other.id === rule.id) continue;
    // The same action applied to the same record always produces the same
    // patch, so two rules that both resolve to the same action can never
    // disagree — only different actions can genuinely fight. Not worth its
    // own step; it's not a check, just a fast skip.
    if (other.actionId === rule.actionId) continue;

    const label = `Checking for a conflict with Policy Rule #${i + 1} ("${other.description}")`;
    const overlap = records.find((r) => matches(r, rule.root) && matches(r, other.root));
    if (!overlap) {
      onStep?.({ label, ok: true });
      continue;
    }

    const orderA = applyIfMatches(applyIfMatches(overlap, rule, planAction), other, planAction);
    const orderB = applyIfMatches(applyIfMatches(overlap, other, planAction), rule, planAction);
    const disagrees = (Object.keys(orderA) as (keyof TRecord)[]).some((key) => JSON.stringify(orderA[key]) !== JSON.stringify(orderB[key]));
    onStep?.({ label, ok: !disagrees });
    if (disagrees) {
      findings.push({
        severity: "error",
        message: `Conflicts with Policy Rule #${i + 1} ("${other.description}"): both match ${overlap.id}, but which one runs first changes the outcome — they're fighting over the same field.`,
      });
    }
  }

  return { ok: findings.every((f) => f.severity !== "error"), findings };
}

// --- Audit trail ----------------------------------------------------------
//
// Lives here (not in the hook) because the reporting engine below needs to
// read it from domain-layer code, which must stay React-free.

export type AuditSource = "human" | "policy";

export type AuditEntry<TRecord, TActionId extends string = string> = {
  id: string;
  label: string;
  time: string;
  /** Real epoch ms, distinct from `time` (a display-only localized string) — what time-windowed reports filter on. */
  timestamp: number;
  before: TRecord[];
  changedRecordIds: string[];
  actionIds: TActionId[];
  source: AuditSource;
  policyRuleId?: string;
};

// --- Reporting ----------------------------------------------------------

export type ReportTimeWindow = "1h" | "24h" | "7d" | "all";

/** A saved report configuration — re-runnable, independent of any one result. */
export type ReportSpec = {
  id: string;
  title: string;
  timeWindow: ReportTimeWindow;
  /** Domain-resolved metric key, e.g. "bitrate" or "auto_remediation_count". */
  metric: string;
  /** Domain-resolved group-by key, e.g. "cdnProvider". */
  groupBy: string;
  createdAt: string;
};

export type ReportRow = { group: string; value: number };

export type ReportResult = {
  spec: ReportSpec;
  rows: ReportRow[];
  total: number;
  generatedAt: string;
};

const REPORT_WINDOW_MS: Record<Exclude<ReportTimeWindow, "all">, number> = {
  "1h": 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
};

export function withinReportWindow(isoOrEpoch: string | number, window: ReportTimeWindow, now = Date.now()): boolean {
  if (window === "all") return true;
  const t = typeof isoOrEpoch === "number" ? isoOrEpoch : new Date(isoOrEpoch).getTime();
  return now - t <= REPORT_WINDOW_MS[window];
}

/** Groups items by a string key and counts each group, largest first. */
export function groupAndCount<T>(items: T[], groupKey: (item: T) => string): ReportRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = groupKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([group, value]) => ({ group, value }))
    .sort((a, b) => b.value - a.value);
}
