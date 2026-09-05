/**
 * Seam for the hackathon's required Partner Track integration. `lib/mcp-tools.ts`
 * builds this domain's own tool list; a partner client's `listTools()`
 * result gets concatenated onto that list before it's sent to the agent
 * backend (see app/api/agent/route.ts), and a functionCall for one of its
 * tool names is dispatched through `callTool()` there instead of the local
 * grid dispatcher. Nothing else in the app needs to know a partner is
 * involved — the browser and hooks/use-grid-agent.ts stay unaware.
 *
 * SERVER-ONLY: every implementation here reads real credentials from
 * process.env and, for ClickHouse, spawns a local subprocess — this file
 * must never be imported from a "use client" component. It's only ever
 * imported from app/api/agent/route.ts (runtime = "nodejs").
 *
 * Currently implemented:
 *   - ClickHouse, via the official `mcp-clickhouse` Python MCP server, run
 *     from an isolated venv — see .mcp-clickhouse-venv/ and the
 *     CLICKHOUSE_* vars in .env.local.example.
 *   - Grafana, via the official `mcp-grafana` Go binary, run from a local
 *     release download — see .mcp-grafana/ and the GRAFANA_* vars in
 *     .env.local.example.
 * Replit is not implemented; it would need e.g. REPLIT_MCP_URL + a Replit
 * API token.
 *
 * PARTNER_MCP selects which of these to attempt — a single id ("clickhouse")
 * or a comma-separated list to run more than one at once ("clickhouse,grafana").
 * "Attempt" because getPartnerMcpClients() below checks each one's
 * isConfigured() first: a partner listed in PARTNER_MCP whose required env
 * vars aren't all set is silently left out entirely, so testing one partner
 * at a time (e.g. a judge with only CLICKHOUSE_* filled in) never wastes a
 * request on a connection that was always going to fail. For a partner that
 * *is* configured, every call site still treats a runtime failure — a
 * subprocess that won't start, a network call that times out — as that
 * one partner's problem only: dropped from the result for that call, logged
 * server-side, and never allowed to take down tool-calling, ingestion, or the
 * chat turn for the others. See the try/catch around each client's use in
 * app/api/agent/route.ts, app/api/sponsor-ingest/route.ts, and
 * app/api/partner-warmup/route.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SponsorEvent } from "./sponsor-event-bus";

export type PartnerMcpTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

export interface PartnerMcpClient {
  /** Selector value for PARTNER_MCP, e.g. "clickhouse" | "grafana" | "replit" | "none". */
  id: string;
  listTools(): Promise<PartnerMcpTool[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  /**
   * Forwards one event from lib/sponsor-event-bus.ts into this partner's own
   * store, if that makes sense for this partner (a database gets a row; a
   * hosting platform might do nothing). No-op by default — every partner
   * client is free to override it, and every call site (app/api/sponsor-ingest/route.ts)
   * stays the same regardless of which partner is actually configured.
   */
  ingestEvent(event: SponsorEvent): Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — add it to .env.local (see .env.local.example) and make sure PARTNER_MCP includes the right partner.`);
  return value;
}

/**
 * ClickHouse string-literal escaping for values interpolated into SQL text.
 * mcp-clickhouse's `run_query` tool takes one raw SQL string with no bind
 * parameters (confirmed against its actual schema — just `{query: string}`),
 * and event summaries/descriptions can contain user-influenced text (e.g. a
 * free-text policy rule description), so every value must be escaped before
 * going anywhere near that string — this is the only thing standing between
 * user input and a SQL injection into a real database.
 */
function chEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Connects to the official ClickHouse MCP server (`mcp-clickhouse`, a
 * Python/FastMCP server — no TypeScript equivalent exists) by spawning it
 * as a stdio subprocess from the venv at .mcp-clickhouse-venv/ (created via
 * `python -m venv .mcp-clickhouse-venv && .mcp-clickhouse-venv/Scripts/pip
 * install mcp-clickhouse`, kept out of the global Python install on
 * purpose). The connection is a lazy singleton — the subprocess starts on
 * the first tool call and is reused for the life of this server process,
 * not respawned per request.
 */
const POLICY_EVENTS_TABLE = "policy_events";

class ClickHousePartnerMcpClient implements PartnerMcpClient {
  id = "clickhouse";
  private clientPromise: Promise<Client> | null = null;
  private tableReady: Promise<void> | null = null;

  /**
   * True only when every env var connect() would otherwise throw on is
   * actually set — checked without throwing or touching the network, so
   * getPartnerMcpClients() can silently leave this partner out entirely
   * (e.g. a judge testing ClickHouse alone with Grafana's vars left blank)
   * instead of attempting, and always failing, a connection for it on
   * every single request.
   */
  static isConfigured(): boolean {
    return Boolean(process.env.CLICKHOUSE_HOST && process.env.CLICKHOUSE_PASSWORD);
  }

  private async connect(): Promise<Client> {
    const bin = path.join(
      process.cwd(),
      ".mcp-clickhouse-venv",
      process.platform === "win32" ? "Scripts/mcp-clickhouse.exe" : "bin/mcp-clickhouse",
    );
    const transport = new StdioClientTransport({
      command: bin,
      env: {
        ...getDefaultEnvironment(),
        CLICKHOUSE_HOST: requireEnv("CLICKHOUSE_HOST"),
        CLICKHOUSE_PORT: process.env.CLICKHOUSE_PORT ?? "8443",
        CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? "default",
        CLICKHOUSE_PASSWORD: requireEnv("CLICKHOUSE_PASSWORD"),
        CLICKHOUSE_SECURE: process.env.CLICKHOUSE_SECURE ?? "true",
        // Without this, mcp-clickhouse's run_query stays read-only and every
        // INSERT ensureTable()/ingestEvent() issues fails with "Cannot
        // execute query in readonly mode" — confirmed live the hard way.
        CLICKHOUSE_ALLOW_WRITE_ACCESS: process.env.CLICKHOUSE_ALLOW_WRITE_ACCESS ?? "false",
      },
    });
    const client = new Client({ name: "relaygrid-cinema", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  /** Connects on first use; if that connection attempt failed, the next call retries instead of reusing a dead promise. */
  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error: unknown) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  async listTools(): Promise<PartnerMcpTool[]> {
    const client = await this.getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const client = await this.getClient();
    return client.callTool({ name, arguments: (args as Record<string, unknown>) ?? {} });
  }

  /** Runs one query through run_query, which mcp-clickhouse rejects unless CLICKHOUSE_ALLOW_WRITE_ACCESS=true is set (see .env.local.example) — a deliberate safety gate on the server's side, not something this client can bypass. */
  private async runQuery(query: string): Promise<void> {
    const result = (await this.callTool("run_query", { query })) as { isError?: boolean; content?: Array<{ text?: string }> };
    if (result?.isError) {
      throw new Error(result.content?.[0]?.text ?? "ClickHouse query failed.");
    }
  }

  /** Creates the events table on first use only — every later ingestEvent call reuses the same resolved promise instead of re-issuing CREATE TABLE IF NOT EXISTS on every event. */
  private ensureTable(): Promise<void> {
    if (!this.tableReady) {
      this.tableReady = this.runQuery(
        `CREATE TABLE IF NOT EXISTS ${POLICY_EVENTS_TABLE} ` +
          `(id String, timestamp DateTime64(3), kind String, source String, summary String, payload String) ` +
          `ENGINE = MergeTree ORDER BY timestamp`,
      ).catch((error: unknown) => {
        this.tableReady = null;
        throw error;
      });
    }
    return this.tableReady;
  }

  /**
   * Every sponsor-bus event becomes one row in ClickHouse — this is the real
   * write path the ClickHouse Partner Track requires, running alongside (not
   * instead of) the local event bus that already drives the Integrations
   * tab's instant UI (see lib/sponsor-event-bus.ts and the doc comment on
   * PartnerMcpClient.ingestEvent above for why both exist).
   */
  async ingestEvent(event: SponsorEvent): Promise<void> {
    await this.ensureTable();
    const values = [
      `'${chEscape(event.id)}'`,
      `fromUnixTimestamp64Milli(${Math.trunc(event.timestamp)})`,
      `'${chEscape(event.kind)}'`,
      `'${chEscape(event.source)}'`,
      `'${chEscape(event.summary)}'`,
      `'${chEscape(JSON.stringify(event.payload))}'`,
    ].join(", ");
    await this.runQuery(`INSERT INTO ${POLICY_EVENTS_TABLE} (id, timestamp, kind, source, summary, payload) VALUES (${values})`);
  }
}

/**
 * Connects to the official Grafana MCP server (`mcp-grafana`, a Go binary —
 * no venv/pip equivalent, so it's a straight release download into
 * .mcp-grafana/ instead of the Python-venv dance ClickHouse needs; see that
 * folder and the GRAFANA_* vars in .env.local.example) as a stdio
 * subprocess in `-t stdio` mode. Same lazy-singleton connection shape as
 * ClickHousePartnerMcpClient above — the subprocess starts on first tool
 * call and is reused for the life of this server process.
 */
class GrafanaPartnerMcpClient implements PartnerMcpClient {
  id = "grafana";
  private clientPromise: Promise<Client> | null = null;

  /**
   * True only when every env var this client needs — both for MCP
   * tool-calling (GRAFANA_URL/GRAFANA_SERVICE_ACCOUNT_TOKEN) and for real
   * Loki ingestion (GRAFANA_LOKI_*) — is actually set. Checked without
   * throwing or touching the network, so getPartnerMcpClients() can
   * silently leave this partner out entirely (e.g. a judge testing
   * ClickHouse alone with Grafana's vars left blank) instead of attempting,
   * and always failing, a connection or a Loki push on every request.
   */
  static isConfigured(): boolean {
    return Boolean(
      process.env.GRAFANA_URL &&
        process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN &&
        process.env.GRAFANA_LOKI_PUSH_URL &&
        process.env.GRAFANA_LOKI_USER &&
        process.env.GRAFANA_LOKI_API_KEY,
    );
  }

  private async connect(): Promise<Client> {
    // On Vercel (any environment — process.env.VERCEL is set on every deploy,
    // not just production), the function runs on Linux, and the git-ignored
    // .mcp-grafana/ Windows .exe used for local dev was never going to work
    // there anyway. vendor/mcp-grafana-linux-x64/ is committed to the repo
    // specifically so Next.js's build-time file tracing bundles it into the
    // deployed function — see that folder's own README for the full reason.
    const bin = process.env.VERCEL
      ? path.join(process.cwd(), "vendor", "mcp-grafana-linux-x64", "mcp-grafana")
      : path.join(process.cwd(), ".mcp-grafana", process.platform === "win32" ? "mcp-grafana.exe" : "mcp-grafana");
    if (process.env.VERCEL) {
      // Git doesn't reliably preserve the executable bit through a Windows
      // checkout -> GitHub -> Vercel build pipeline, so set it defensively
      // right before spawning rather than trusting it survived deployment.
      try {
        fs.chmodSync(bin, 0o755);
      } catch {
        // Best-effort — if this fails, the spawn below will surface a clear EACCES instead.
      }
    }
    const transport = new StdioClientTransport({
      command: bin,
      args: ["-t", "stdio"],
      env: {
        ...getDefaultEnvironment(),
        GRAFANA_URL: requireEnv("GRAFANA_URL"),
        GRAFANA_SERVICE_ACCOUNT_TOKEN: requireEnv("GRAFANA_SERVICE_ACCOUNT_TOKEN"),
      },
    });
    const client = new Client({ name: "relaygrid-cinema", version: "1.0.0" });
    await client.connect(transport);
    return client;
  }

  /** Connects on first use; if that connection attempt failed, the next call retries instead of reusing a dead promise. */
  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error: unknown) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  async listTools(): Promise<PartnerMcpTool[]> {
    const client = await this.getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const client = await this.getClient();
    return client.callTool({ name, arguments: (args as Record<string, unknown>) ?? {} });
  }

  /**
   * Pushes one sponsor-bus event as a real Loki log line — the write path
   * GrafanaTab's copy (components/sponsor-integrations.tsx) already
   * describes ("What would be pushed to loki.grafana.net/loki/api/v1/push
   * as each action fires"). This is deliberately separate from the MCP
   * tool-calling path above: mcp-grafana wraps Grafana's own HTTP API
   * (dashboards, alerts, incidents, and read-only Loki/Prometheus queries),
   * which has no "write a log line" tool — Loki's push endpoint is a
   * distinct service with its own auth, a Loki-scoped access policy token
   * from the stack's "Loki -> Details" page in Grafana Cloud, not the
   * Grafana service-account token used above.
   */
  async ingestEvent(event: SponsorEvent): Promise<void> {
    const url = requireEnv("GRAFANA_LOKI_PUSH_URL");
    const user = requireEnv("GRAFANA_LOKI_USER");
    const apiKey = requireEnv("GRAFANA_LOKI_API_KEY");
    const level = event.kind === "incident_injected" ? "warn" : "info";
    const line = JSON.stringify({ level, source: event.source, kind: event.kind, msg: event.summary, ...event.payload });
    // Loki wants each entry's timestamp as a nanosecond-precision Unix string; event.timestamp is milliseconds.
    const nanos = `${Math.trunc(event.timestamp)}000000`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${user}:${apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify({
        streams: [{ stream: { service: "relaygrid", level, kind: event.kind, source: event.source }, values: [[nanos, line]] }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Loki push failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
}

let clickHouseSingleton: ClickHousePartnerMcpClient | null = null;
let grafanaSingleton: GrafanaPartnerMcpClient | null = null;

/** Parses PARTNER_MCP into the list of configured partner ids — comma-separated ("clickhouse,grafana"), whitespace-tolerant, "none"/blank entries dropped. Unset or "none" alone means no partner at all. */
function configuredPartnerIds(): string[] {
  const raw = process.env.PARTNER_MCP;
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== "none");
}

// getPartnerMcpClients() runs on every single request (sponsor-ingest fires
// once per grid event) — without this, a partner a judge hasn't configured
// yet would print its skip warning on every one of those instead of once.
const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

/**
 * Maps one id to its singleton client — or null (with a one-time warning)
 * when the id is unrecognized, or when it's a real partner but not actually
 * configured (its required env vars aren't all set). Either way this never
 * throws: a typo in PARTNER_MCP, or a partner a judge hasn't set up yet,
 * should just quietly run with one fewer partner than PARTNER_MCP lists,
 * never crash the server or spam retries that were always going to fail.
 */
function clientFor(id: string): PartnerMcpClient | null {
  if (id === "clickhouse") {
    if (!ClickHousePartnerMcpClient.isConfigured()) {
      warnOnce("clickhouse", `[partner-mcp] PARTNER_MCP lists "clickhouse" but CLICKHOUSE_HOST/CLICKHOUSE_PASSWORD aren't both set — skipping it (see .env.local.example).`);
      return null;
    }
    return (clickHouseSingleton ??= new ClickHousePartnerMcpClient());
  }
  if (id === "grafana") {
    if (!GrafanaPartnerMcpClient.isConfigured()) {
      warnOnce(
        "grafana",
        `[partner-mcp] PARTNER_MCP lists "grafana" but not all of GRAFANA_URL/GRAFANA_SERVICE_ACCOUNT_TOKEN/GRAFANA_LOKI_PUSH_URL/GRAFANA_LOKI_USER/GRAFANA_LOKI_API_KEY are set — skipping it (see .env.local.example).`,
      );
      return null;
    }
    return (grafanaSingleton ??= new GrafanaPartnerMcpClient());
  }
  warnOnce(`unknown:${id}`, `[partner-mcp] Unknown PARTNER_MCP entry "${id}" — ignoring it. Valid values: clickhouse, grafana.`);
  return null;
}

/**
 * Every partner MCP client PARTNER_MCP configures — zero, one, or more than
 * one at once. Callers are expected to treat each client independently (see
 * the file-header comment above): one partner being down or misconfigured
 * should never stop the others, or the caller's own request, from working.
 */
export function getPartnerMcpClients(): PartnerMcpClient[] {
  return configuredPartnerIds()
    .map(clientFor)
    .filter((client): client is PartnerMcpClient => client !== null);
}
