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
 * API token — selected via PARTNER_MCP.
 */
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

class NoPartnerMcpClient implements PartnerMcpClient {
  id = "none";
  async listTools(): Promise<PartnerMcpTool[]> {
    return [];
  }
  async callTool(): Promise<unknown> {
    throw new Error("No partner MCP server is configured (PARTNER_MCP is unset).");
  }
  async ingestEvent(): Promise<void> {
    // No partner configured — nothing to forward to.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — add it to .env.local (see .env.local.example) and set PARTNER_MCP=clickhouse.`);
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

  private async connect(): Promise<Client> {
    const bin = path.join(process.cwd(), ".mcp-grafana", process.platform === "win32" ? "mcp-grafana.exe" : "mcp-grafana");
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

/** Selects the partner MCP client from PARTNER_MCP. Defaults to none. */
export function getPartnerMcpClient(): PartnerMcpClient {
  const id = process.env.PARTNER_MCP;
  if (!id || id === "none") return new NoPartnerMcpClient();
  if (id === "clickhouse") return (clickHouseSingleton ??= new ClickHousePartnerMcpClient());
  if (id === "grafana") return (grafanaSingleton ??= new GrafanaPartnerMcpClient());
  throw new Error(`Partner MCP integration "${id}" is not implemented yet. Leave PARTNER_MCP unset to run without one.`);
}
