# RelayGrid Cinema

A domain-agnostic agentic grid engine, launched with its first domain: **Media, Streaming & Cinema Operations**. Built for the Google Cloud Agentic Cinema Hackathon on **Gemini** (`@google/genai`) and the **WebMCP / MCP** protocol.

**Live:** https://relaygrid-cinema.vercel.app · **Repo:** https://github.com/LimorMimon/relaygrid-cinema

> **Current scope / known gaps vs. the Devpost requirements**
> This build is an in-progress milestone for the [Agentic Cinema hackathon](https://agentic-cinema.devpost.com/), not a submission-ready entry yet.
> 1. **Google Cloud Agent Builder / the Gemini Enterprise Agent Platform** — `lib/agent-backends/agent-builder.ts` calls `@google/genai` with `vertexai: true` against a real GCP project. Per the hackathon's own rules page, `@google/genai`/`google-genai` is an explicitly accepted SDK — the Vertex flag plus a real project is what makes this "Google Cloud" usage, not a separate Agent Engine/ADK deployment (which would also fight this app's per-request dynamic toolset). **Confirmed working end to end locally** via Application Default Credentials (`gcloud auth application-default login`), not a service-account key — this project's org policy enforces `iam.disableServiceAccountKeyCreation`, blocking key creation entirely, and Workload Identity Federation for Vercel wasn't implemented given the timeline. Two non-obvious fixes were needed to get a real response back: `GOOGLE_CLOUD_LOCATION` must be `"global"`, not a region like `us-central1` (newer Gemini models 404 on regional endpoints), and the Google account authenticating via ADC needs the "Agent Platform User" IAM role on the project — which may not be the account that created the project, if more than one is signed in. Practical result: **the live Vercel deployment still runs `gemini-direct`** (the AI Studio backend) — Vercel's serverless environment has no `gcloud` session to draw ADC from — while `agent-builder` is exercised locally (see `.env.local.example`'s Google Cloud section) and in the demo video. `gemini-direct` remains the default and stays fully functional either way.
> 2. **A Partner Track integration** — done: ClickHouse (see "How Gemini connects to MCP" below and `lib/partner-mcp.ts`). Grafana and Replit remain simulated previews only (`components/sponsor-integrations.tsx`).

Split-screen layout:

- **Left — RelayGrid**: a live stream-operations worklist (Stream ID, Channel/Program, CDN Provider, Bitrate, FPS, Audio Status, Subtitle Sync, Status Flags).
- **Right — Judge Demo Guide & Agent Chat**: split into its own two columns (guide + action card, then chat) so a long conversation and a tall action preview never squeeze each other out. The chat is a Gemini-powered copilot that controls the grid entirely through MCP tool calls.

## Why this is domain-agnostic

The engine (`lib/grid-engine.ts`, `lib/domains/types.ts`, `lib/mcp-tools.ts`) knows nothing about media or medicine — it operates on `DomainConfig<TRecord, TActionId>`: a record shape, a field list, a set of actions, a data generator, and an eligibility function. `lib/domains/cinema.ts` is the first implementation of that contract. A future Healthcare/Radiology domain is a second file satisfying the same contract; nothing else in the app changes.

## How Gemini connects to MCP

`lib/mcp-tools.ts` defines six tools (`describe_grid`, `apply_query`, `explain_record`, `preview_action`, `execute_action`, `undo_last_action`) once, from the active domain. They're consumed by two callers against the exact same live grid state:

1. **Native WebMCP** — registered via `document.modelContext.registerTool` whenever the browser exposes it, so any MCP-aware agent browser can drive the grid directly.
2. **The in-app Gemini chat panel** — the browser sends the conversation + tool schemas to `app/api/agent/route.ts`, a thin, domain-agnostic relay that hands the turn to whichever `AgentBackend` is selected (`lib/agent-backends/`, via `AGENT_BACKEND`). Both implementations share the same function-calling loop (`lib/agent-backends/genai-shared.ts`) and differ only in how their `@google/genai` client authenticates: `gemini-direct` (default) holds `GEMINI_API_KEY` server-side against the public AI Studio API; `agent-builder` uses `vertexai: true` against a real GCP project via a service account. When the model returns a `functionCall`, the browser executes it locally against the real grid state and sends the result back to continue the loop.

**Safety boundary**: `execute_action` is intentionally *not* given to Gemini — only `preview_action` is. The mutating step only ever runs when a human clicks **Approve & Execute** on the action card the UI renders from a preview, calling the tool directly. Gemini can prepare, but never confirm, a change.

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

That's everything needed for the default setup (`AGENT_BACKEND=gemini-direct`, `PARTNER_MCP=clickhouse`). Every other variable in `.env.local.example` is commented with exactly what it's for and where to get it — fill in the `CLICKHOUSE_*` ones for a real ClickHouse Cloud connection, or the `GOOGLE_CLOUD_*` ones plus `AGENT_BACKEND=agent-builder` to run the agent through Vertex AI instead of AI Studio.

The **Judge Demo Guide** on the right walks through the headline scenario step by step — each step has a "Send to chat" button that fires the exact prompt, or use **Run full scenario** to drive steps 1–3 automatically.

## Project layout

```
lib/grid-engine.ts       Generic condition/query engine + batch action planner
lib/domains/types.ts     DomainConfig contract
lib/domains/cinema.ts    Domain 1: stream records, actions, eligibility rules
lib/mcp-tools.ts         Tool schemas (MCP + Gemini) and the shared dispatcher
lib/agent-prompt.ts      Domain-aware system instruction for Gemini
lib/agent-backends/      AgentBackend seam: gemini-direct (AI Studio) + agent-builder (Vertex AI)
lib/partner-mcp.ts       Partner MCP client: ClickHouse (live); Grafana/Replit not implemented
hooks/use-grid-agent.ts  React state + tool handlers for one domain
app/api/agent/route.ts   Thin, backend-agnostic relay (delegates to lib/agent-backends)
components/              RelayGrid, Agent Chat, Action Card, Judge Demo Guide
```

`./reference` is a local, git-ignored clone of the original `relaygrid-webmcp` project, kept for research only — it is not part of this app.

## License

[MIT](./LICENSE)
