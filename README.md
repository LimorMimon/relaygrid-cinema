# RelayGrid Cinema

A domain-agnostic agentic grid engine, launched with its first domain: **Media, Streaming & Cinema Operations**. Built for the Google Cloud Agentic Cinema Hackathon on **Gemini** (`@google/genai`) and the **WebMCP / MCP** protocol.

**Live:** https://relaygrid-cinema.vercel.app · **Repo:** https://github.com/LimorMimon/relaygrid-cinema

> **Current scope / known gaps vs. the Devpost requirements**
> This build is an in-progress milestone for the [Agentic Cinema hackathon](https://agentic-cinema.devpost.com/), not a submission-ready entry yet. Phase 1 gets the Gemini + WebMCP/MCP application layer working end-to-end, with clean seams left for the two still-mandatory pieces:
> 1. **Google Cloud Agent Builder / the Gemini Enterprise Agent Platform** — today the app calls the public Gemini API directly (`@google/genai` against an AI Studio key) through the `gemini-direct` agent backend (see `lib/agent-backends/`). `lib/agent-backends/agent-builder.ts` is the drop-in seam for the real integration; it currently throws "not implemented."
> 2. **A Partner Track integration** — Grafana Labs or Replit (decision pending). `lib/partner-mcp.ts` is the seam where a partner's MCP tools would be merged into the tool list; it currently returns none.

Split-screen layout:

- **Left — RelayGrid**: a live stream-operations worklist (Stream ID, Channel/Program, CDN Provider, Bitrate, FPS, Audio Status, Subtitle Sync, Status Flags).
- **Right — Judge Demo Guide & Agent Chat**: split into its own two columns (guide + action card, then chat) so a long conversation and a tall action preview never squeeze each other out. The chat is a Gemini-powered copilot that controls the grid entirely through MCP tool calls.

## Why this is domain-agnostic

The engine (`lib/grid-engine.ts`, `lib/domains/types.ts`, `lib/mcp-tools.ts`) knows nothing about media or medicine — it operates on `DomainConfig<TRecord, TActionId>`: a record shape, a field list, a set of actions, a data generator, and an eligibility function. `lib/domains/cinema.ts` is the first implementation of that contract. A future Healthcare/Radiology domain is a second file satisfying the same contract; nothing else in the app changes.

## How Gemini connects to MCP

`lib/mcp-tools.ts` defines six tools (`describe_grid`, `apply_query`, `explain_record`, `preview_action`, `execute_action`, `undo_last_action`) once, from the active domain. They're consumed by two callers against the exact same live grid state:

1. **Native WebMCP** — registered via `document.modelContext.registerTool` whenever the browser exposes it, so any MCP-aware agent browser can drive the grid directly.
2. **The in-app Gemini chat panel** — the browser sends the conversation + tool schemas to `app/api/agent/route.ts`, a thin, domain-agnostic relay that hands the turn to whichever `AgentBackend` is selected (`lib/agent-backends/`, via `AGENT_BACKEND`). Phase 1 uses `gemini-direct`, which holds `GEMINI_API_KEY` server-side and calls `@google/genai` directly. When the model returns a `functionCall`, the browser executes it locally against the real grid state and sends the result back to continue the loop.

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

The **Judge Demo Guide** on the right walks through the headline scenario step by step — each step has a "Send to chat" button that fires the exact prompt, or use **Run full scenario** to drive steps 1–3 automatically.

## Project layout

```
lib/grid-engine.ts       Generic condition/query engine + batch action planner
lib/domains/types.ts     DomainConfig contract
lib/domains/cinema.ts    Domain 1: stream records, actions, eligibility rules
lib/mcp-tools.ts         Tool schemas (MCP + Gemini) and the shared dispatcher
lib/agent-prompt.ts      Domain-aware system instruction for Gemini
lib/agent-backends/      AgentBackend seam: gemini-direct (live) + agent-builder (stub)
lib/partner-mcp.ts       Partner MCP client seam (not implemented yet)
hooks/use-grid-agent.ts  React state + tool handlers for one domain
app/api/agent/route.ts   Thin, backend-agnostic relay (delegates to lib/agent-backends)
components/              RelayGrid, Agent Chat, Action Card, Judge Demo Guide
```

`./reference` is a local, git-ignored clone of the original `relaygrid-webmcp` project, kept for research only — it is not part of this app.

## License

[MIT](./LICENSE)
