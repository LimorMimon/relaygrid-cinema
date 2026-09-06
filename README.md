# RelayGrid Cinema

A domain-agnostic agentic grid engine, launched with its first domain: **Media, Streaming & Cinema Operations**. Built for the Google Cloud Agentic Cinema Hackathon on **Gemini** (`@google/genai`) and the **WebMCP / MCP** protocol.

**Live:** https://relaygrid-cinema.vercel.app · **Repo:** https://github.com/LimorMimon/relaygrid-cinema

> **Current scope vs. the Devpost requirements**
> This build is a milestone for the [Agentic Cinema hackathon](https://agentic-cinema.devpost.com/); the only thing not yet done is recording the required demo video (see `VIDEO_SCRIPT.md`). Both required integrations are real and verified live on the public URL itself, not just locally:
> 1. **Google Cloud Agent Builder / the Gemini Enterprise Agent Platform** — `lib/agent-backends/agent-builder.ts` calls `@google/genai` with `vertexai: true` against a real GCP project (`google-genai`/`@google/genai` is an explicitly accepted SDK per the hackathon's rules page). The live app authenticates via **Workload Identity Federation** — Vercel's own OIDC token exchanged for short-lived Google credentials (`@vercel/oidc` + `google-auth-library`'s `ExternalAccountClient`), impersonating a service account with no key ever created or stored, which is what makes this possible at all given this project's `iam.disableServiceAccountKeyCreation` org policy. **Confirmed live on `relaygrid-cinema.vercel.app` itself**: a real chat turn round-tripped through Vertex AI, called `apply_query` for real, and came back tagged "Google Cloud · Vertex AI" (see the header badge). Local dev still uses Application Default Credentials (`gcloud auth application-default login`) unchanged. Full GCP Console setup steps in `.env.local.example`.
> 2. **A Partner Track integration — Grafana Labs is the declared track, also tested on ClickHouse.** Both run **live on the public URL itself**, no restrictions, no local-only caveats. Grafana: the official `mcp-grafana` MCP server actually runs inside Vercel's Linux serverless functions (a vendored Linux binary, `vendor/mcp-grafana-linux-x64/` — Grafana Cloud's own hosted MCP endpoint turned out to require interactive OAuth with no machine-to-machine option, so it wasn't usable from a headless function) for real tool-calling, and pushes every event straight into a real Grafana Cloud Loki stream. Confirmed live on `relaygrid-cinema.vercel.app`: 81 tools registered, and a real `Approve & Execute` click landed real log lines in Grafana Cloud with the tab's badge reading "Live". ClickHouse: writes every event into a real `policy_events` table on ClickHouse Cloud, live in production — confirmed with a real `Approve & Execute` click and a 4-request concurrent burst against the public URL, all succeeding in under 3s each — via a direct call to ClickHouse Cloud's own HTTP interface (its official `mcp-clickhouse` MCP server is a Python venv, so its tool-calling is exercised locally rather than bundled into the Vercel function). `PARTNER_MCP` runs both together (`clickhouse,grafana`) on the live deployment as well as locally. Every call site treats each partner independently (`getPartnerMcpClients()`), so one having a problem (bad credentials, a subprocess that won't start) is silently dropped for that call and logged server-side — confirmed live: a deliberately broken Loki URL and an invalid partner id both failed without affecting the other partner or the app. In the Integrations tab (`components/sponsor-integrations.tsx`), both tabs ask the server (`app/api/partner-info/route.ts`) which partners are actually configured and only show "Live" when truly active, and both now share the same row layout — metadata (Time/Kind/Source) on one line, the full message on its own full-width line below it.

Split-screen layout:

- **Left — RelayGrid**: a live stream-operations worklist (Stream ID, Channel/Program, CDN Provider, Bitrate, FPS, Audio Status, Subtitle Sync, Status Flags).
- **Right — Judge Demo Guide & Agent Chat**: split into its own two columns (guide + action card, then chat) so a long conversation and a tall action preview never squeeze each other out. The chat is a Gemini-powered copilot that controls the grid entirely through MCP tool calls.

## Why this is domain-agnostic

The engine (`lib/grid-engine.ts`, `lib/domains/types.ts`, `lib/mcp-tools.ts`) knows nothing about media or medicine — it operates on `DomainConfig<TRecord, TActionId>`: a record shape, a field list, a set of actions, a data generator, and an eligibility function. `lib/domains/cinema.ts` is the first implementation of that contract. A future Healthcare/Radiology domain is a second file satisfying the same contract; nothing else in the app changes.

## How Gemini connects to MCP

`lib/mcp-tools.ts` defines six tools (`describe_grid`, `apply_query`, `explain_record`, `preview_action`, `execute_action`, `undo_last_action`) once, from the active domain. They're consumed by two callers against the exact same live grid state:

1. **Native WebMCP** — registered via `document.modelContext.registerTool` whenever the browser exposes it, so any MCP-aware agent browser can drive the grid directly.
2. **The in-app Gemini chat panel** — the browser sends the conversation + tool schemas to `app/api/agent/route.ts`, a thin, domain-agnostic relay that hands the turn to whichever `AgentBackend` is selected (`lib/agent-backends/`, via `AGENT_BACKEND`). Both implementations share the same function-calling loop (`lib/agent-backends/genai-shared.ts`) and differ only in how their `@google/genai` client authenticates: `gemini-direct` (default) holds `GEMINI_API_KEY` server-side against the public AI Studio API; `agent-builder` uses `vertexai: true` against a real GCP project via a service account. When the model returns a `functionCall`, the browser executes it locally against the real grid state and sends the result back to continue the loop.

**Safety boundary**: `execute_action` is not given to Gemini or to native WebMCP — only `preview_action` is (`hooks/use-grid-agent.ts`'s `agentVisibleSchemas`, which filters `execute_action` out of both surfaces before they're built). The mutating step only ever runs when a human clicks **Approve & Execute** on the action card the UI renders from a preview, which calls the tool directly through `createToolDispatcher` — a path that never goes through either agent surface. See "Security notes" below for why this is enforced by what's excluded from the tool list, not by asking the model nicely, and for the other places the same reasoning applies.

## Security notes

Not a claim that this is "secure" in any absolute sense — a record of the specific risks
this codebase actually has to deal with, given that both an LLM and real external SaaS
accounts sit in the request path, and what's actually done about each one. Found and fixed
during this build, not designed in from the start — worth being honest about that too.

- **A tool that mutates data must not be something an agent can decide to call on its own.**
  `execute_action` was, for a while, present in the exact same schema list handed to Gemini
  and to native WebMCP as every read-only tool — its only gate was a client-supplied
  `humanConfirmed` boolean, which a model can simply set itself if a crafted prompt (or an
  ordinarily-phrased one it just reasons its way into) asks it to. Nothing server-side
  checked that a real human had actually clicked anything. The fix isn't a stronger prompt
  instruction telling Gemini not to call it — instructions are advice, not enforcement, and
  a sufficiently adversarial or just unlucky input can talk a model out of following one.
  The fix is that the tool is no longer in the list a model can choose from at all
  (`agentVisibleSchemas` in `hooks/use-grid-agent.ts`); the only remaining caller is the
  UI's own button handler, which was never mediated by an LLM in the first place.
- **The same reasoning applies harder to partner MCP tools, because they touch a real
  external account with no preview step at all.** The vendored `mcp-grafana` server exposes
  81 tools against this project's actual Grafana Cloud stack, and — unlike this app's own
  grid actions — a partner tool call is resolved and executed immediately server-side
  (`app/api/agent/route.ts`) the moment the model asks for it; there is no equivalent of
  `preview_action`/`execute_action` in that path at all. Roughly a quarter of those 81 tools
  are real writes — `update_dashboard`, `create_folder`, `alerting_manage_rules`,
  `delete_snapshot`, and a generic `grafana_api_request` passthrough with no restriction on
  method or endpoint. All 81 were originally merged into Gemini's tool list without
  distinction. The fix uses the MCP spec's own tool annotations (`readOnlyHint`,
  `destructiveHint`), which `mcp-grafana` already self-declares accurately per tool, and
  only advertises or dispatches a partner tool when `readOnlyHint === true` — checked live
  against the running server: 62 of 81 survive the filter, and every mutating one is
  excluded. A tool with no annotations at all is treated as unsafe, not safe — default-deny,
  not default-allow, since trusting an unannotated tool to be harmless is exactly the
  assumption that was wrong the first time.
- **A schema only prevents injection for the parts of it that are actually structured.**
  `apply_query`'s `field` and `operator` parameters are closed enums checked against the
  domain's real field list (`validateQuery` in `lib/grid-engine.ts`) — not just "the model
  is well-behaved enough to only send valid ones," but a second, independent check of
  whatever the model actually sent back, on the assumption that schema adherence is a strong
  bias in a function-calling model, not a guarantee. A `string`-typed parameter with no enum
  is a different situation entirely: the schema enforces "this is text," nothing about what's
  inside that text. `mcp-clickhouse`'s `run_query` tool takes exactly one such parameter —
  raw SQL as a string — which is why this project's ClickHouse write path
  (`lib/partner-mcp.ts`'s `ingestEvent`) escapes every user-influenced string value
  (`chEscape`, backslash- and quote-escaping) before it goes anywhere near a `VALUES (...)`
  clause, rather than assuming the presence of a schema already handled it.
- **What isn't specifically hardened here**: the underlying model's susceptibility to
  prompt injection in the first place (a malicious policy-rule description or report title
  could still influence *what* Gemini decides to try, just not what it's structurally
  capable of doing once it tries); rate limiting or abuse protection on the public API routes;
  and anything downstream of a partner's own account-level permissions (a real Grafana
  service-account token scoped more broadly than it needs to be is a risk this codebase
  can't see or fix from the outside).

## Getting started

The hosted app (link above) already has a Gemini key configured server-side — you don't
need your own key just to try it. Your own key is only needed to run the repo **locally**:

1. `npm install`
2. `cp .env.local.example .env.local` — this creates a new `.env.local` file in the project root.
3. Open `.env.local` and paste your key on the `GEMINI_API_KEY=` line, e.g.:
   ```
   GEMINI_API_KEY=AIzaSy...your-key-here
   ```
   Get a free key at https://aistudio.google.com/apikey. `.env.local` is git-ignored, so it
   never gets committed.
4. `npm run dev`, then open http://localhost:3000.

That's everything needed for the default setup (`AGENT_BACKEND=gemini-direct`, no partner configured yet). Every other variable in `.env.local.example` is commented with exactly what it's for and where to get it — fill in the `CLICKHOUSE_*` ones for a real ClickHouse Cloud connection and/or the `GRAFANA_*` ones (download `mcp-grafana` into `.mcp-grafana/` first, see the comment above those vars) for a real Grafana Cloud connection, then set `PARTNER_MCP` to whichever you filled in — a single id, or both at once as `clickhouse,grafana` (the default in `.env.local.example`). Or fill in the `GOOGLE_CLOUD_*` ones plus `AGENT_BACKEND=agent-builder` to run the agent through Vertex AI instead of AI Studio.

The **Judge Demo Guide** on the right walks through the headline scenario step by step — each step has a "Send to chat" button that fires the exact prompt, or use **Run full scenario** to drive steps 1–3 automatically.

## Project layout

```
lib/grid-engine.ts       Generic condition/query engine + batch action planner
lib/domains/types.ts     DomainConfig contract
lib/domains/cinema.ts    Domain 1: stream records, actions, eligibility rules
lib/mcp-tools.ts         Tool schemas (MCP + Gemini) and the shared dispatcher
lib/agent-prompt.ts      Domain-aware system instruction for Gemini
lib/agent-backends/      AgentBackend seam: gemini-direct (AI Studio) + agent-builder (Vertex AI)
lib/partner-mcp.ts       Partner MCP clients: ClickHouse and Grafana (both live, can run together); Replit not implemented
hooks/use-grid-agent.ts  React state + tool handlers for one domain
app/api/agent/route.ts   Thin, backend-agnostic relay (delegates to lib/agent-backends)
components/              RelayGrid, Agent Chat, Action Card, Judge Demo Guide
```

`./reference` is a local, git-ignored clone of the original `relaygrid-webmcp` project, kept for research only — it is not part of this app.

## Going to production

This build is shaped for the hackathon demo — real Vertex AI calls, real Grafana Cloud
writes, but a generated/seeded dataset and simulated action execution. See
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for what needs to change (including a
time-sensitive one: Grafana Cloud's free tier is a 14-day trial) before this runs against
a real customer's data and infrastructure.

## License

[MIT](./LICENSE)
