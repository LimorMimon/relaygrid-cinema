/**
 * The Media & Streaming domain — the only file in the app that knows what a
 * "StreamRecord" is. `lib/grid-engine.ts` supplies generic filtering,
 * batch-action planning, policy evaluation, and reporting math; everything
 * here maps that generic machinery onto this domain's real fields
 * (bitrate, CDN provider, audio/subtitle sync) and its 3 real actions.
 *
 * Read top to bottom: synthetic data generation → action execution rules →
 * policy-rule glue (standing automation) → reporting glue (analytics) →
 * the seeded default policy rules → the suggested-rule catalog → demo-only
 * tooling → `cinemaDomain`, the single object every other layer imports to
 * plug this domain into the generic engine, hook, and MCP tool schema.
 */
import type {
  AuditEntry,
  Operator,
  PolicyRiskLevel,
  PolicyRule,
  PolicySuggestion,
  QueryNode,
  ReportResult,
  ReportSpec,
  ReportSuggestion,
  ReportTimeWindow,
  Transition,
} from "@/lib/grid-engine";
import { groupAndCount, matches, withinReportWindow } from "@/lib/grid-engine";
import type { AddPolicyRuleArgs, GenerateReportArgs } from "@/lib/mcp-tools";
import type { DomainConfig } from "@/lib/domains/types";

export type CDNProvider = "US-East" | "US-West" | "EU-West" | "EU-Central" | "APAC-East";
export type AudioStatus = "OK" | "Muted" | "Desync" | "Encoder Error";
export type SubtitleSync = "In Sync" | "Drifting" | "Out of Sync" | "Missing";
export type StreamStatus = "Healthy" | "Degraded" | "Failing" | "Rerouted" | "Auto-Resolved";

export type StreamRecord = {
  id: string;
  channel: string;
  cdnProvider: CDNProvider;
  bitrateMbps: number;
  fps: number;
  audioStatus: AudioStatus;
  subtitleSync: SubtitleSync;
  status: StreamStatus;
  statusFlags: string[];
  lastUpdated: string;
  failoverAvailable: boolean;
};

export type CinemaActionId = "switch_failover_cdn" | "restart_audio_encoder" | "resync_subtitles";

export const STATUS_LABELS: Record<StreamStatus, string> = {
  Healthy: "Healthy",
  Degraded: "Degraded",
  Failing: "Failing",
  Rerouted: "Healthy / Rerouted",
  "Auto-Resolved": "Auto-Resolved",
};

const FAILOVER_MAP: Record<CDNProvider, CDNProvider> = {
  "EU-West": "US-East",
  "EU-Central": "US-East",
  "US-East": "US-West",
  "US-West": "US-East",
  "APAC-East": "US-West",
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function deriveFlags(fields: Pick<StreamRecord, "bitrateMbps" | "audioStatus" | "subtitleSync">): string[] {
  const flags: string[] = [];
  if (fields.bitrateMbps < 3) flags.push("Low Bitrate");
  if (fields.audioStatus !== "OK") flags.push(`Audio: ${fields.audioStatus}`);
  if (fields.subtitleSync !== "In Sync") flags.push(`Subtitles: ${fields.subtitleSync}`);
  return flags;
}

function deriveStatus(flags: string[], bitrateMbps: number): StreamStatus {
  if (flags.length === 0) return "Healthy";
  if (bitrateMbps < 1.5 || flags.length >= 2) return "Failing";
  return "Degraded";
}

const CHANNELS = [
  "CineMax Prime — Feature Presentation",
  "GlobalSport 1 — Live Match",
  "StudioFeed 4K — Premiere Night",
  "NewsWire 24 — Live Desk",
  "IndieReel — Festival Selects",
  "DocuWorld — Live Broadcast",
  "ArenaLive — Championship Round",
  "KidsBeam — Saturday Block",
  "ConcertStage — Live Set",
  "GameCast — Tournament Finals",
];

const CDN_PROVIDERS: CDNProvider[] = ["US-East", "US-West", "EU-West", "EU-Central", "APAC-East"];

const rnd = (seed: number) => {
  const x = Math.sin(seed * 999.91) * 43758.5453;
  return x - Math.floor(x);
};

// Anchored to real wall-clock time so "last 24h"-style queries the agent
// constructs against `lastUpdated` stay meaningful whenever the app runs.
const NOW = Date.now();

export function generateStreams(count = 220): StreamRecord[] {
  const records: StreamRecord[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const provider = CDN_PROVIDERS[Math.floor(rnd(n) * CDN_PROVIDERS.length)];
    const isDegraded = rnd(n + 211) < 0.1;
    const bitrateMbps = isDegraded
      ? Math.round((1 + rnd(n + 31) * 2.5) * 10) / 10
      : Math.round((5 + rnd(n + 31) * 7) * 10) / 10;
    const audioStatus: AudioStatus =
      rnd(n + 52) < 0.1 ? (["Muted", "Desync", "Encoder Error"] as const)[Math.floor(rnd(n + 53) * 3)] : "OK";
    const subtitleSync: SubtitleSync =
      rnd(n + 74) < 0.1
        ? (["Drifting", "Out of Sync", "Missing"] as const)[Math.floor(rnd(n + 75) * 3)]
        : "In Sync";
    const flags = deriveFlags({ bitrateMbps, audioStatus, subtitleSync });
    return {
      id: `STREAM-CDN-${String(n).padStart(3, "0")}`,
      channel: CHANNELS[n % CHANNELS.length],
      cdnProvider: provider,
      bitrateMbps,
      fps: bitrateMbps < 3 ? [15, 24][n % 2] : [50, 60][n % 2],
      audioStatus,
      subtitleSync,
      status: deriveStatus(flags, bitrateMbps),
      statusFlags: flags,
      lastUpdated: new Date(NOW - Math.floor(rnd(n + 92) * 72 * 3600000)).toISOString(),
      failoverAvailable: rnd(n + 140) > 0.05,
    };
  });

  // Guaranteed, deterministic incident row for the headline demo scenario.
  const incident: StreamRecord = {
    id: "STREAM-CDN-804",
    channel: "ArenaLive — Championship Round",
    cdnProvider: "EU-West",
    // 2.4, not the original 1.8 — kept below the 3.0 "healthy" threshold
    // (still matches the guide's "bitrate below 3Mbps" filter and needs a
    // failover) but at/above 2.0, so the default REQUIRES_APPROVAL CDN
    // policy rule (below) doesn't immediately pop an action card for it
    // before the guided demo even starts.
    bitrateMbps: 2.4,
    fps: 24,
    audioStatus: "Desync",
    // "Out of Sync", not "Drifting" — the default AUTONOMOUS subtitle policy
    // (below) auto-fixes "Drifting" on sight, which would silently resolve
    // this seeded incident before the guided demo ever gets to it.
    subtitleSync: "Out of Sync",
    status: "Failing",
    statusFlags: deriveFlags({ bitrateMbps: 2.4, audioStatus: "Desync", subtitleSync: "Out of Sync" }),
    lastUpdated: new Date(NOW - 2 * 3600000).toISOString(),
    failoverAvailable: true,
  };
  // Placed at a fixed low index so it always sits in the first visible batch,
  // regardless of how a query happens to sort or slice the results.
  records[0] = incident;

  return records;
}

function restoredBitrate(id: string): number {
  return Math.round((6 + (hashString(id) % 35) / 10) * 10) / 10;
}

export function planCinemaAction(record: StreamRecord, action: CinemaActionId): Transition<StreamRecord, CinemaActionId> {
  const base = { recordId: record.id, action };

  if (action === "switch_failover_cdn") {
    if (record.bitrateMbps >= 3) {
      return { ...base, allowed: false, reason: "Bitrate is within the healthy range; failover is not required.", patch: {} };
    }
    if (!record.failoverAvailable) {
      return { ...base, allowed: false, reason: "No failover CDN is configured for this stream.", patch: {} };
    }
    const nextProvider = FAILOVER_MAP[record.cdnProvider];
    const nextBitrate = restoredBitrate(record.id);
    const merged = { ...record, cdnProvider: nextProvider, bitrateMbps: nextBitrate };
    const flags = deriveFlags(merged);
    return {
      ...base,
      allowed: true,
      reason: `Rerouted from ${record.cdnProvider} to ${nextProvider}; bitrate restored to ${nextBitrate.toFixed(1)} Mbps.`,
      patch: {
        cdnProvider: nextProvider,
        bitrateMbps: nextBitrate,
        statusFlags: flags,
        // "Rerouted" reports the CDN failover itself, independent of any other
        // flag (e.g. a lingering subtitle issue) the record may still carry.
        status: "Rerouted",
      },
    };
  }

  if (action === "restart_audio_encoder") {
    if (record.audioStatus === "OK") {
      return { ...base, allowed: false, reason: "Audio encoder is already healthy.", patch: {} };
    }
    const merged = { ...record, audioStatus: "OK" as const };
    const flags = deriveFlags(merged);
    return {
      ...base,
      allowed: true,
      reason: "Audio encoder restarted; audio status restored to OK.",
      patch: {
        audioStatus: "OK",
        statusFlags: flags,
        // Once a stream has been rerouted this session, keep reporting that —
        // don't let a later action's flag count silently downgrade it.
        status: record.status === "Rerouted" ? "Rerouted" : deriveStatus(flags, merged.bitrateMbps),
      },
    };
  }

  // resync_subtitles
  if (record.subtitleSync === "In Sync") {
    return { ...base, allowed: false, reason: "Subtitles are already in sync.", patch: {} };
  }
  const merged = { ...record, subtitleSync: "In Sync" as const };
  const flags = deriveFlags(merged);
  return {
    ...base,
    allowed: true,
    reason: "Subtitle track resynced.",
    patch: {
      subtitleSync: "In Sync",
      statusFlags: flags,
      status: record.status === "Rerouted" ? "Rerouted" : deriveStatus(flags, merged.bitrateMbps),
    },
  };
}

// --- Policy engine glue -----------------------------------------------
//
// The `add_policy_rule` MCP tool hands Gemini's parsed natural-language
// rule here as loose strings; this module is the only place that knows how
// those map onto real StreamRecord fields and CinemaActionIds.

const POLICY_METRIC_ALIASES: Record<string, keyof StreamRecord & string> = {
  bitrate: "bitrateMbps",
  bitrate_mbps: "bitrateMbps",
  bitrateMbps: "bitrateMbps",
  fps: "fps",
  audio_status: "audioStatus",
  audioStatus: "audioStatus",
  subtitle_sync: "subtitleSync",
  subtitleSync: "subtitleSync",
  cdn_provider: "cdnProvider",
  cdnProvider: "cdnProvider",
  // No dedicated CDN-health field exists — the record's own derived
  // `status` ("Degraded"/"Failing"/...) is what stands in for it.
  cdn_status: "status",
  status: "status",
};

const POLICY_METRIC_NUMERIC_FIELDS = new Set<keyof StreamRecord>(["bitrateMbps", "fps"]);

const POLICY_OPERATOR_ALIASES: Record<string, Operator> = {
  "<": "lt",
  ">": "gt",
  "==": "eq",
  "=": "eq",
  "!=": "neq",
};

/** Friendly action names Gemini (or a default rule) may ask for → real CinemaActionId. */
export const POLICY_ACTION_ALIASES: Record<string, CinemaActionId> = {
  resync_audio: "restart_audio_encoder",
  restart_audio_encoder: "restart_audio_encoder",
  restart_encoder: "restart_audio_encoder",
  flush_subtitle_buffer: "resync_subtitles",
  resync_subtitles: "resync_subtitles",
  switch_cdn: "switch_failover_cdn",
  switch_cdn_provider: "switch_failover_cdn",
  switch_failover_cdn: "switch_failover_cdn",
};

/**
 * Safety clamp: the model may *request* AUTONOMOUS for any action, but the
 * system — not Gemini — has final say on which actions are ever allowed to
 * run without a human clicking Approve & Execute. Rerouting a live CDN is
 * capped at REQUIRES_APPROVAL no matter what the request says.
 */
export const POLICY_ACTION_MAX_RISK: Record<CinemaActionId, PolicyRiskLevel> = {
  restart_audio_encoder: "AUTONOMOUS",
  resync_subtitles: "AUTONOMOUS",
  switch_failover_cdn: "REQUIRES_APPROVAL",
};

function clampRisk(requested: PolicyRiskLevel, actionId: CinemaActionId): PolicyRiskLevel {
  return POLICY_ACTION_MAX_RISK[actionId] === "REQUIRES_APPROVAL" ? "REQUIRES_APPROVAL" : requested;
}

export function resolveCinemaPolicyRule(
  input: AddPolicyRuleArgs,
): PolicyRule<StreamRecord, CinemaActionId> | { error: string } {
  const field = POLICY_METRIC_ALIASES[input.metric_key];
  if (!field) {
    return { error: `Unknown metric_key "${input.metric_key}". Supported: ${Object.keys(POLICY_METRIC_ALIASES).join(", ")}` };
  }
  const operator = POLICY_OPERATOR_ALIASES[input.operator];
  if (!operator) {
    return { error: `Unknown operator "${input.operator}". Supported: <, >, ==, !=` };
  }
  const actionId = POLICY_ACTION_ALIASES[input.target_action];
  if (!actionId) {
    return { error: `Unknown target_action "${input.target_action}". Supported: ${Object.keys(POLICY_ACTION_ALIASES).join(", ")}` };
  }
  const requestedRisk: PolicyRiskLevel = input.risk_level === "AUTONOMOUS" ? "AUTONOMOUS" : "REQUIRES_APPROVAL";
  const riskLevel = clampRisk(requestedRisk, actionId);
  const value = POLICY_METRIC_NUMERIC_FIELDS.has(field) ? Number(input.threshold_value) : String(input.threshold_value);

  return {
    id: `policy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description:
      input.condition_description?.trim() || `${input.metric_key} ${input.operator} ${input.threshold_value} → ${input.target_action}`,
    root: { kind: "condition", field, operator, value },
    actionId,
    riskLevel,
    createdAt: new Date().toISOString(),
  };
}

// --- Reporting engine glue ----------------------------------------------
//
// The `generate_analytics_report` MCP tool hands Gemini's parsed request
// here as loose strings; this module decides how filter_metric/group_by map
// onto real StreamRecord fields (or the audit trail, for auto-remediation
// counts) and rejects anything that doesn't have a real, well-defined
// meaning rather than inventing one — e.g. there is no "resolution" field
// on StreamRecord, so it is never accepted as a group_by.

/**
 * Fields with a real, bounded set of values — the only ones a report can
 * bucket rows by. Accepts both the snake_case aliases the tool description
 * teaches (matching add_policy_rule's convention) and the raw StreamRecord
 * field names, since the generic mcp-tools.ts schema advertises the latter
 * verbatim and Gemini sometimes uses those instead.
 */
const REPORT_GROUPABLE_FIELDS: Record<string, keyof StreamRecord & string> = {
  cdn_provider: "cdnProvider",
  cdnProvider: "cdnProvider",
  audio_status: "audioStatus",
  audioStatus: "audioStatus",
  subtitle_sync: "subtitleSync",
  subtitleSync: "subtitleSync",
  status: "status",
  cdn_status: "status",
};

type IssueMetric = { field: keyof StreamRecord & string; isIssue: (record: StreamRecord) => boolean };

/**
 * What counts as "an issue" for each supported filter_metric — mirrors the
 * same thresholds `deriveFlags`/`deriveStatus` already use elsewhere, so a
 * report's counts agree with what the grid itself flags as unhealthy.
 */
const REPORT_ISSUE_METRICS: Record<string, IssueMetric> = {
  audio_status: { field: "audioStatus", isIssue: (r) => r.audioStatus !== "OK" },
  audioStatus: { field: "audioStatus", isIssue: (r) => r.audioStatus !== "OK" },
  subtitle_sync: { field: "subtitleSync", isIssue: (r) => r.subtitleSync !== "In Sync" },
  subtitleSync: { field: "subtitleSync", isIssue: (r) => r.subtitleSync !== "In Sync" },
  status: { field: "status", isIssue: (r) => r.status === "Degraded" || r.status === "Failing" },
  cdn_status: { field: "status", isIssue: (r) => r.status === "Degraded" || r.status === "Failing" },
  bitrate: { field: "bitrateMbps", isIssue: (r) => r.bitrateMbps < 3 },
  bitrate_mbps: { field: "bitrateMbps", isIssue: (r) => r.bitrateMbps < 3 },
  bitrateMbps: { field: "bitrateMbps", isIssue: (r) => r.bitrateMbps < 3 },
};

const REPORT_TIME_WINDOWS = new Set<ReportTimeWindow>(["1h", "24h", "7d", "all"]);

export function resolveCinemaReport(
  records: StreamRecord[],
  audit: AuditEntry<StreamRecord, CinemaActionId>[],
  args: GenerateReportArgs,
): ReportResult | { error: string } {
  const timeWindow = args.time_window as ReportTimeWindow;
  if (!REPORT_TIME_WINDOWS.has(timeWindow)) {
    return { error: `Unknown time_window "${args.time_window}". Supported: 1h, 24h, 7d, all` };
  }

  const groupField = REPORT_GROUPABLE_FIELDS[args.group_by];
  if (!groupField) {
    return {
      error:
        `Unknown group_by "${args.group_by}". Supported: ${Object.keys(REPORT_GROUPABLE_FIELDS).join(", ")} ` +
        `— numeric, date, and id-like fields have too many unique values to group by.`,
    };
  }

  const spec: ReportSpec = {
    id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: args.report_title?.trim() || `${args.filter_metric} by ${args.group_by}`,
    timeWindow,
    metric: args.filter_metric,
    groupBy: args.group_by,
    createdAt: new Date().toISOString(),
  };

  if (args.filter_metric === "auto_remediation_count") {
    const recordById = new Map(records.map((r) => [r.id, r]));
    const affected = audit
      .filter((entry) => entry.source === "policy" && withinReportWindow(entry.timestamp, timeWindow))
      .flatMap((entry) => entry.changedRecordIds)
      .map((id) => recordById.get(id))
      .filter((r): r is StreamRecord => Boolean(r));
    const rows = groupAndCount(affected, (r) => String(r[groupField]), (r) => r.id);
    return { spec, rows, total: affected.length, generatedAt: new Date().toISOString() };
  }

  const issueMetric = REPORT_ISSUE_METRICS[args.filter_metric];
  if (!issueMetric) {
    return {
      error:
        `Unknown filter_metric "${args.filter_metric}". Supported: ${Object.keys(REPORT_ISSUE_METRICS).join(", ")}, ` +
        `auto_remediation_count`,
    };
  }

  const matched = records.filter((r) => issueMetric.isIssue(r) && withinReportWindow(r.lastUpdated, timeWindow));
  const rows = groupAndCount(matched, (r) => String(r[groupField]), (r) => r.id);
  return { spec, rows, total: matched.length, generatedAt: new Date().toISOString() };
}

/**
 * The report catalog for this domain — same role as
 * POLICY_RULE_SUGGESTION_CATALOG below: curated, not a full
 * metric×group_by cross product (5×4 would be mostly noise), picked to
 * cover every filter_metric exactly once, each paired with the groupBy an
 * ops conversation actually reaches for first (which CDN provider is this
 * concentrated on?). Suggested until added; once added, it's an Active
 * report the Reports tab can re-run anytime.
 */
type ReportCatalogEntry = {
  key: string;
  title: string;
  rationale: string;
  filterMetric: string;
  groupBy: string;
  timeWindow: ReportTimeWindow;
};

const REPORT_CATALOG: ReportCatalogEntry[] = [
  {
    key: "bitrate-by-cdn-24h",
    title: "Low-bitrate streams by CDN provider (last 24h)",
    rationale: "Bitrate collapse (<3 Mbps) is usually the leading indicator that later shows up as an audio or subtitle failure — catching it here catches the root cause, not just the symptom.",
    filterMetric: "bitrate",
    groupBy: "cdn_provider",
    timeWindow: "24h",
  },
  {
    key: "audio-by-cdn-24h",
    title: "Audio issues by CDN provider (last 24h)",
    rationale: "Whether audio problems cluster on one provider or spread evenly points at a provider-side cause vs. isolated device/encoder issues.",
    filterMetric: "audio_status",
    groupBy: "cdn_provider",
    timeWindow: "24h",
  },
  {
    key: "subtitles-by-cdn-24h",
    title: "Subtitle sync issues by CDN provider (last 24h)",
    rationale: "The same clustering question for caption drift/missing tracks — a CDN-wide caption pipeline problem looks very different from a handful of isolated streams.",
    filterMetric: "subtitle_sync",
    groupBy: "cdn_provider",
    timeWindow: "24h",
  },
  {
    key: "status-by-cdn-all",
    title: "Degraded or failing streams by CDN provider (all time)",
    rationale: "A running tally of which provider carries the most unhealthy streams overall — a provider-performance conversation, not just today's incidents.",
    filterMetric: "status",
    groupBy: "cdn_provider",
    timeWindow: "all",
  },
  {
    key: "auto-remediation-by-cdn-24h",
    title: "Auto-remediations by CDN provider (last 24h)",
    rationale: "How concentrated the policy engine's autonomous fixes are on one provider — a high count there is either that provider's real instability, or a sign a rule is mis-targeted.",
    filterMetric: "auto_remediation_count",
    groupBy: "cdn_provider",
    timeWindow: "24h",
  },
];

/**
 * Deterministic — computed from real current data (each candidate's
 * matchCount runs through the exact same resolveCinemaReport the "Add"
 * button will call), never invented. Excludes anything already active
 * (same metric + groupBy + timeWindow already in savedReportSpecs) —
 * mirrors listPolicyRuleSuggestions' own exclusion of already-added rules
 * below, so a report you've added moves from Suggested to Active instead
 * of staying listed in both.
 */
export function listCinemaSuggestedReports(
  records: StreamRecord[],
  audit: AuditEntry<StreamRecord, CinemaActionId>[],
  activeReportSpecs: ReportSpec[],
): ReportSuggestion[] {
  return REPORT_CATALOG.filter(
    (c) => !activeReportSpecs.some((s) => s.metric === c.filterMetric && s.groupBy === c.groupBy && s.timeWindow === c.timeWindow),
  )
    .map((c) => {
      const result = resolveCinemaReport(records, audit, {
        report_title: c.title,
        time_window: c.timeWindow,
        filter_metric: c.filterMetric,
        group_by: c.groupBy,
        save_report: false,
      });
      return {
        key: c.key,
        title: c.title,
        rationale: c.rationale,
        filterMetric: c.filterMetric,
        groupBy: c.groupBy,
        timeWindow: c.timeWindow,
        matchCount: "error" in result ? 0 : result.total,
      };
    })
    .sort((a, b) => b.matchCount - a.matchCount);
}

// --- Default policy rules ---------------------------------------------
//
// Seeded automatically for every new session (see PolicyOptions.defaultRules
// in cinema-grid-app.tsx) — these are what's already active before a human
// or Gemini adds anything.

const SEEDED_AT = new Date(NOW).toISOString();

/**
 * The three pre-configured rules from the spec, plus the two-part Failover
 * Readiness Triage ladder below them (added later, see its own comment).
 * Two notes on translating the original spec's rules to this data model:
 * (1) Rule 1 says audio "Out of Sync" — our AudioStatus enum has no such
 * value, so this uses "Desync", the audio value that actually means the
 * same thing. (2) Rule 2 says subtitle_sync "Delayed" — SubtitleSync has no
 * such value either; "Drifting" is the closest real one (accumulating
 * timing delay).
 */
export const DEFAULT_POLICY_RULES: PolicyRule<StreamRecord, CinemaActionId>[] = [
  {
    id: "policy-default-audio-resync",
    description: "Audio desync on an otherwise healthy stream → auto-restart the audio encoder",
    root: {
      kind: "group",
      operator: "AND",
      children: [
        { kind: "condition", field: "audioStatus", operator: "eq", value: "Desync" },
        { kind: "condition", field: "bitrateMbps", operator: "gte", value: 3.0 },
      ],
    },
    actionId: "restart_audio_encoder",
    riskLevel: "AUTONOMOUS",
    createdAt: SEEDED_AT,
  },
  {
    id: "policy-default-subtitle-flush",
    description: "Subtitles drifting → auto-flush the subtitle buffer",
    root: { kind: "condition", field: "subtitleSync", operator: "eq", value: "Drifting" },
    actionId: "resync_subtitles",
    riskLevel: "AUTONOMOUS",
    createdAt: SEEDED_AT,
  },
  {
    id: "policy-default-cdn-failover",
    description: "Bitrate critically low or CDN degraded → switch CDN provider (human approval required)",
    root: {
      kind: "group",
      operator: "OR",
      children: [
        { kind: "condition", field: "bitrateMbps", operator: "lt", value: 2.0 },
        { kind: "condition", field: "status", operator: "eq", value: "Degraded" },
      ],
    },
    actionId: "switch_failover_cdn",
    riskLevel: "REQUIRES_APPROVAL",
    createdAt: SEEDED_AT,
  },
  // --- Failover Readiness Triage (2-part decision ladder) ---------------
  //
  // Real gap the rule above has: it escalates every degraded/failing stream
  // for a human to review a reroute — including streams where
  // `failoverAvailable` is false, where that reroute cannot actually
  // succeed (planCinemaAction rejects it outright). Paging a human for an
  // action that structurally can't run is real alert fatigue, a well-known
  // ops anti-pattern this industry cares about. This ladder branches on the
  // one field no other rule reads (`failoverAvailable`) to reroute *only*
  // when a fix is actually reachable, and otherwise auto-remediate whatever
  // symptom is safe to self-heal — so a human is never paged over a
  // broadcast that has no failover path to review in the first place:
  //   if (!failoverAvailable)
  //     if (audioStatus != "OK")            -> auto-restart the audio encoder
  //     else if (subtitleSync != "In Sync") -> auto-resync subtitles
  //   else                                   -> already handled by the rule above
  {
    id: "policy-default-no-failover-audio",
    description: "No failover CDN configured and audio is at fault → auto-restart the audio encoder",
    root: {
      kind: "group",
      operator: "AND",
      children: [
        { kind: "condition", field: "failoverAvailable", operator: "eq", value: false },
        { kind: "condition", field: "audioStatus", operator: "neq", value: "OK" },
      ],
    },
    actionId: "restart_audio_encoder",
    riskLevel: "AUTONOMOUS",
    createdAt: SEEDED_AT,
  },
  {
    id: "policy-default-no-failover-subtitle",
    description: "No failover CDN configured and subtitles are at fault → auto-resync subtitles",
    root: {
      kind: "group",
      operator: "AND",
      children: [
        { kind: "condition", field: "failoverAvailable", operator: "eq", value: false },
        { kind: "condition", field: "subtitleSync", operator: "neq", value: "In Sync" },
      ],
    },
    actionId: "resync_subtitles",
    riskLevel: "AUTONOMOUS",
    createdAt: SEEDED_AT,
  },
  // --- Compounding-Symptom Escalation (the genuinely nested one) --------
  //
  // Real broadcast-ops judgment call, not a flat single-condition trigger:
  // a stream only moderately below the healthy 3.0 Mbps line isn't alone
  // grounds for a disruptive live reroute — default rule #3 already leaves
  // it alone above 2.0 Mbps. But moderate degradation *combined with* a
  // second, independent symptom (audio OR subtitles also failing) usually
  // means a shared root cause (origin/encoder trouble), not two unlucky
  // coincidences — and that combination is worth a human's attention
  // before it worsens. The NOT clause exists so a stream this same tick's
  // AUTONOMOUS rules just healed doesn't immediately get re-flagged:
  //
  //   IF   1.5 <= bitrateMbps < 3.0                 (moderately degraded —
  //                                                    not yet caught by #3)
  //   AND  (audioStatus != "OK" OR subtitleSync != "In Sync")
  //                                                  (a second, independent
  //                                                    fault at the same time)
  //   AND  NOT (status == "Auto-Resolved")          (don't re-flag something
  //                                                    just self-healed)
  //   THEN switch_failover_cdn, REQUIRES_APPROVAL   (always human-reviewed —
  //                                                    a live reroute is
  //                                                    never automatic)
  {
    id: "policy-default-compounding-symptom-escalation",
    description: "Moderate bitrate degradation AND a second independent fault → escalate a full reroute for review",
    root: {
      kind: "group",
      operator: "AND",
      children: [
        {
          kind: "group",
          operator: "AND",
          children: [
            { kind: "condition", field: "bitrateMbps", operator: "gte", value: 1.5 },
            { kind: "condition", field: "bitrateMbps", operator: "lt", value: 3.0 },
          ],
        },
        {
          kind: "group",
          operator: "OR",
          children: [
            { kind: "condition", field: "audioStatus", operator: "neq", value: "OK" },
            { kind: "condition", field: "subtitleSync", operator: "neq", value: "In Sync" },
          ],
        },
        { kind: "not", child: { kind: "condition", field: "status", operator: "eq", value: "Auto-Resolved" } },
      ],
    },
    actionId: "switch_failover_cdn",
    riskLevel: "REQUIRES_APPROVAL",
    createdAt: SEEDED_AT,
  },
  // --- Audio Fault Response (a genuine if/else — two different actions) -
  //
  // Real judgment call: not every audio fault deserves the same fix.
  // `audioStatus` can only ever hold one value at a time, so these two
  // rules are strictly mutually exclusive — a true branch, not just two
  // rules that happen to both fire:
  //   IF   audioStatus == "Muted"          -> a routing/mute-toggle glitch,
  //                                            safe and reversible to fix
  //                                            by simply restarting the
  //                                            encoder — AUTONOMOUS.
  //   ELSE IF audioStatus == "Encoder Error" -> the encoder itself is
  //                                            reporting a hard fault;
  //                                            restarting the SAME failed
  //                                            component twice rarely
  //                                            helps, so escalate for a
  //                                            full reroute instead —
  //                                            REQUIRES_APPROVAL.
  // See CINEMA_DECISION_LADDERS below — that's what lets the UI render
  // these two rules together as one branching flowchart instead of two
  // unrelated list entries.
  {
    id: "policy-default-audio-muted-response",
    description: "Audio muted → auto-restart the audio encoder (the reversible fix)",
    root: { kind: "condition", field: "audioStatus", operator: "eq", value: "Muted" },
    actionId: "restart_audio_encoder",
    riskLevel: "AUTONOMOUS",
    createdAt: SEEDED_AT,
  },
  {
    id: "policy-default-audio-encoder-error-response",
    description: "Audio encoder reporting a hard fault → escalate a full reroute instead of retrying the same fix",
    root: { kind: "condition", field: "audioStatus", operator: "eq", value: "Encoder Error" },
    actionId: "switch_failover_cdn",
    riskLevel: "REQUIRES_APPROVAL",
    createdAt: SEEDED_AT,
  },
];

/**
 * Purely a presentation-layer grouping — the policy engine itself still
 * evaluates each branch as its own independent PolicyRule (see above); this
 * is what lets the UI recognize that two particular rules together form one
 * if/else decision and render them as a single branching flowchart instead
 * of two disconnected list entries.
 */
export type DecisionLadder = {
  id: string;
  title: string;
  triggerLabel: string;
  branches: { ruleId: string; conditionLabel: string }[];
};

export const CINEMA_DECISION_LADDERS: DecisionLadder[] = [
  {
    id: "audio-fault-response",
    title: "Audio Fault Response",
    triggerLabel: "audioStatus",
    branches: [
      { ruleId: "policy-default-audio-muted-response", conditionLabel: "= Muted" },
      { ruleId: "policy-default-audio-encoder-error-response", conditionLabel: "= Encoder Error" },
    ],
  },
];

// --- Suggested policy rules ---------------------------------------------
//
// A small, fixed catalog of candidate rules — each one genuinely functional
// (planCinemaAction already handles the underlying field it checks) and
// deliberately NOT already covered by DEFAULT_POLICY_RULES above, so a
// suggestion always represents real, additional automation rather than a
// duplicate of what's already active. Picked for relevance to live
// broadcast/cinema operations specifically (the hackathon's domain), not
// generic filler: silent audio and missing captions are total viewer-facing
// failures, and the "Failing" catch-all closes the one status the default
// CDN-failover rule (bitrate/"Degraded" only) doesn't reach.
type PolicyRuleSuggestionTemplate = {
  key: string;
  description: string;
  rationale: string;
  root: QueryNode<StreamRecord>;
  actionId: CinemaActionId;
  riskLevel: PolicyRiskLevel;
};

const POLICY_RULE_SUGGESTION_CATALOG: PolicyRuleSuggestionTemplate[] = [
  {
    key: "muted-audio-autofix",
    description: "Audio muted on an otherwise healthy stream → auto-restart the audio encoder",
    rationale: "Silent live audio is a total viewer-facing failure — safe to auto-fix since it's reversible and the stream is otherwise healthy. The default audio rule only covers desync, not a full mute.",
    root: {
      kind: "group",
      operator: "AND",
      children: [
        { kind: "condition", field: "audioStatus", operator: "eq", value: "Muted" },
        { kind: "condition", field: "bitrateMbps", operator: "gte", value: 3.0 },
      ],
    },
    actionId: "restart_audio_encoder",
    riskLevel: "AUTONOMOUS",
  },
  {
    key: "missing-subtitles-autofix",
    description: "Subtitles missing entirely → auto-resync the subtitle track",
    rationale: "A fully missing caption track is an accessibility-compliance risk, not just a sync-drift annoyance — the default subtitle rule only catches drifting, not a missing track.",
    root: { kind: "condition", field: "subtitleSync", operator: "eq", value: "Missing" },
    actionId: "resync_subtitles",
    riskLevel: "AUTONOMOUS",
  },
  {
    key: "failing-status-safety-net",
    description: "Any stream in the worst health state (Failing) → switch to failover CDN for review",
    rationale: "Closes a gap in the default failover rule, which only triggers on low bitrate or a \"Degraded\" status — a stream with multiple simultaneous issues can reach \"Failing\" without tripping either condition. Always a human-reviewed reroute, never automatic.",
    root: { kind: "condition", field: "status", operator: "eq", value: "Failing" },
    actionId: "switch_failover_cdn",
    riskLevel: "REQUIRES_APPROVAL",
  },
];

/** Deterministic — computed from real current data, never invented. Excludes anything already added (tracked via PolicyRule.sourceKey). */
export function listPolicyRuleSuggestions(
  records: StreamRecord[],
  activeRules: PolicyRule<StreamRecord, CinemaActionId>[],
): PolicySuggestion<StreamRecord>[] {
  const addedKeys = new Set(activeRules.map((r) => r.sourceKey).filter((k): k is string => Boolean(k)));
  return POLICY_RULE_SUGGESTION_CATALOG.filter((c) => !addedKeys.has(c.key))
    .map((c) => ({
      key: c.key,
      description: c.description,
      rationale: c.rationale,
      actionLabel: cinemaDomain.actions.find((a) => a.id === c.actionId)?.label ?? c.actionId,
      riskLevel: clampRisk(c.riskLevel, c.actionId),
      matchCount: records.filter((r) => matches(r, c.root)).length,
      root: c.root,
      actionId: c.actionId,
    }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

export function resolveSuggestedPolicyRule(key: string): PolicyRule<StreamRecord, CinemaActionId> | { error: string } {
  const candidate = POLICY_RULE_SUGGESTION_CATALOG.find((c) => c.key === key);
  if (!candidate) return { error: `Unknown suggestion_key "${key}".` };
  return {
    id: `policy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: candidate.description,
    root: candidate.root,
    actionId: candidate.actionId,
    riskLevel: clampRisk(candidate.riskLevel, candidate.actionId),
    createdAt: new Date().toISOString(),
    sourceKey: candidate.key,
  };
}

// --- Demo tooling ---------------------------------------------------------
//
// Everything in this app runs on an in-memory synthetic dataset — there is
// no real backend, so nothing ever changes the grid except this app's own
// actions. `injectRandomIncident` is an explicit, human-triggered test-harness
// escape hatch: it mutates one currently-healthy record to prove the policy
// engine reacts to genuinely new problems, not just the ones seeded at load.
// It is intentionally NOT an MCP tool — it isn't a real agent capability.

type IncidentTemplate = { label: string; apply: () => Partial<StreamRecord> };

const INCIDENT_TEMPLATES: IncidentTemplate[] = [
  { label: "Muted audio", apply: () => ({ audioStatus: "Muted" }) },
  { label: "Audio desync", apply: () => ({ audioStatus: "Desync" }) },
  { label: "Subtitles drifting", apply: () => ({ subtitleSync: "Drifting" }) },
  { label: "Subtitles missing entirely", apply: () => ({ subtitleSync: "Missing" }) },
  { label: "Bitrate collapse", apply: () => ({ bitrateMbps: Math.round((1 + Math.random() * 1.5) * 10) / 10 }) },
];

export function injectRandomIncident(
  records: StreamRecord[],
): { records: StreamRecord[]; summary: string; changedId: string } | { error: string } {
  const candidates = records.filter((r) => r.statusFlags.length === 0);
  if (candidates.length === 0) {
    return { error: "Every stream already has an active issue — resolve some or reset the session before simulating a new one." };
  }
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const template = INCIDENT_TEMPLATES[Math.floor(Math.random() * INCIDENT_TEMPLATES.length)];
  const merged = { ...target, ...template.apply() };
  const flags = deriveFlags(merged);
  const updated: StreamRecord = {
    ...merged,
    statusFlags: flags,
    status: deriveStatus(flags, merged.bitrateMbps),
    lastUpdated: new Date().toISOString(),
  };

  return {
    records: records.map((r) => (r.id === target.id ? updated : r)),
    summary: `Simulated incident: ${updated.id} (${updated.channel}) now has ${template.label}.`,
    changedId: updated.id,
  };
}

// --- Domain config ---------------------------------------------------------
//
// The single object every other layer imports: the hook (useGridAgent),
// the MCP tool schema builder, and the top-level page component all plug
// into the generic engine through this — nothing else in the app needs to
// know a StreamRecord has a `bitrateMbps` field.
export const cinemaDomain: DomainConfig<StreamRecord, CinemaActionId> = {
  id: "media-streaming",
  name: "Media & Streaming",
  recordLabel: "stream",
  batchSize: 25,
  fields: [
    { key: "id", label: "Stream ID", type: "string" },
    { key: "channel", label: "Channel / Program", type: "string" },
    { key: "cdnProvider", label: "CDN Provider", type: "enum", enumValues: CDN_PROVIDERS },
    { key: "bitrateMbps", label: "Bitrate (Mbps)", type: "number" },
    { key: "fps", label: "FPS", type: "number" },
    { key: "audioStatus", label: "Audio Status", type: "enum", enumValues: ["OK", "Muted", "Desync", "Encoder Error"] },
    { key: "subtitleSync", label: "Subtitle Sync", type: "enum", enumValues: ["In Sync", "Drifting", "Out of Sync", "Missing"] },
    { key: "status", label: "Status", type: "enum", enumValues: ["Healthy", "Degraded", "Failing", "Rerouted", "Auto-Resolved"] },
    { key: "lastUpdated", label: "Last Updated", type: "date" },
  ],
  actions: [
    { id: "switch_failover_cdn", label: "Switch to Failover CDN", description: "Reroutes the stream to its configured failover CDN and restores bitrate." },
    { id: "restart_audio_encoder", label: "Restart Audio Encoder", description: "Restarts the audio encoder to clear mute/desync/encoder errors." },
    { id: "resync_subtitles", label: "Resync Subtitles", description: "Re-establishes subtitle timing sync with the video track." },
  ],
  generateRecords: generateStreams,
  planAction: planCinemaAction,
  examplePrompts: [
    "Show streams with bitrate below 3Mbps or audio/subtitle sync issues in the last 24h.",
    "Explain why the first visible stream matched.",
    "Preview switching the current visible batch to their failover CDN and restarting the audio encoder.",
    "I approve. Execute this preview.",
    "Undo the last batch action.",
  ],
};
