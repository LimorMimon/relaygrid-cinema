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
export type PolicySuggestion = {
  key: string;
  description: string;
  rationale: string;
  actionLabel: string;
  riskLevel: PolicyRiskLevel;
  matchCount: number;
};

/** Pure evaluation: which records currently match each active policy rule. */
export function evaluatePolicyRules<TRecord extends { id: string }, TActionId extends string>(
  records: TRecord[],
  rules: PolicyRule<TRecord, TActionId>[],
): Array<{ rule: PolicyRule<TRecord, TActionId>; matches: TRecord[] }> {
  return rules.map((rule) => ({ rule, matches: records.filter((record) => matches(record, rule.root)) }));
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
