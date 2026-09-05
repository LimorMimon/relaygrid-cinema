# Devpost submission draft — Agentic Cinema hackathon

Copy these into the Devpost submission form fields when you submit. This file is a staging
draft, not the submission itself — it lives in the repo for convenience, nothing here is
sent anywhere automatically.

## ⚠ Before you submit — not yet done

- [ ] **3-Minute Trailer (Demo Video)** — required, not recorded yet. Upload to YouTube or
      Vimeo (public, English or English subtitles) and paste the link below.
- [x] **Partner Track** — ClickHouse, with real runtime integration: `lib/partner-mcp.ts`
      spawns the official `mcp-clickhouse` MCP server and writes every sponsor event into a
      real `policy_events` table on ClickHouse Cloud (see the ClickHouse tab in Integrations
      — it's marked "Live", not "Simulated"). Grafana and Replit remain simulated previews.
- [ ] **Google Cloud Agent Builder / Gemini Enterprise Agent Platform** — code-complete,
      **being verified locally**. `lib/agent-backends/agent-builder.ts` calls `@google/genai`
      with `vertexai: true` against a real Google Cloud project (`google-genai`/`@google/genai`
      is explicitly listed as an accepted SDK on the hackathon's rules page). Auth is via
      Application Default Credentials (`gcloud auth application-default login`), not a
      service-account key — this GCP project enforces `iam.disableServiceAccountKeyCreation`,
      which blocks key creation outright, and Workload Identity Federation for Vercel wasn't
      worth the remaining time. **Consequence: the live Vercel app stays on `gemini-direct`**
      (Vercel has no `gcloud` session to draw ADC from) — `agent-builder` is demonstrated via
      local run + the demo video, not the public URL. See `.env.local.example` for exact
      setup steps and this trade-off spelled out.

Submitting before these are done risks disqualification on "Technological Implementation"
— see the earlier gap analysis in `README.md`.

## Project links

- **Live app:** https://relaygrid-cinema.vercel.app
- **Public source:** https://github.com/LimorMimon/relaygrid-cinema
- **Demo video:** _(not recorded yet)_
- **Partner track:** ClickHouse (real runtime integration — `lib/partner-mcp.ts`)

## One-line summary

**RelayGrid Cinema turns a media-ops control room into a shared human-agent surface: Gemini reasons over the live stream grid through MCP tool calls, while every mutating action stays behind an explicit human "Approve & Execute" click.**

## Inspiration

Streaming/CDN infrastructure already does *some* self-healing — AWS Elemental MediaLive can
auto-failover on audio loss, multi-CDN setups auto-reroute around a degraded network. But
that automation is rigid and per-stream: a fixed threshold on one signal, no view of the
fleet as a whole, and nothing an operator can question or reason with. An operator watching
hundreds of streams still has to notice a cross-stream pattern by hand — correlating
bitrate, audio, and subtitle telemetry — before any of that per-stream automation even
applies.

Broader IT/network operations have already started moving past this: modern AIOps
platforms correlate across systems and gate risky actions behind human approval instead of
running everything autonomously. That same reasoning-plus-approval layer doesn't yet exist
for media/streaming ops specifically — the tools above still stop at a single fixed rule
per stream.

RelayGrid Cinema brings that layer to media ops. The agent understands the whole grid,
investigates a fault in plain language across bitrate, audio, and subtitle signals
together, and turns raw telemetry into an explained, ready-to-approve fix — instead of a
fixed if-audio-silent-then-failover rule with no fleet-wide context. Every mutating action
still stays behind an explicit human "Approve & Execute" click: the same trust-tiered
autonomy AIOps already validates for risk-gating automated fixes, applied here to a domain
that doesn't have it yet.

## What it does

The left-hand grid shows live stream health (CDN, bitrate, FPS, audio, subtitle sync,
status). Ask Gemini in plain language — "show streams with bitrate below 3 Mbps or
audio/subtitle issues in the last 24h" — and it filters the grid live via an MCP tool call,
explains why a specific stream matched, and prepares a remediation action (failover CDN +
restart audio encoder) as a non-mutating preview. Nothing changes until a human clicks
**Approve & Execute** on the action card. A one-click "Run full scenario" button drives the
same flow automatically for live demos, stopping right before that human-confirmation step.

## Why WebMCP/MCP is essential

Every grid mutation — filter, explain, preview, execute, undo — goes through one shared set
of six MCP tools (`lib/mcp-tools.ts`), described once and consumed by two callers: native
WebMCP (`document.modelContext.registerTool`, for any MCP-aware agent browser) and our own
Gemini-powered chat panel. The `execute_action` tool is deliberately **not** exposed to
Gemini's function-calling toolset at all — it's only reachable from the UI button — so the
mutating step can never be taken by the model itself, only by a human who saw the preview.

## How we built it

`lib/grid-engine.ts` is a domain-agnostic condition-tree query engine and batch-action
planner, generic over any record type. `lib/domains/cinema.ts` is the first concrete domain
(Media & Streaming) built on that contract — the same engine is meant to support future
domains (e.g. a healthcare worklist) without changes elsewhere. Gemini access goes through
a swappable `lib/agent-backends/` interface (`AgentBackend`): both the default AI-Studio
backend and the Google Cloud one share one function-calling loop
(`lib/agent-backends/genai-shared.ts`) and differ only in how their `@google/genai` client
authenticates — an API key vs. `vertexai: true` against a real GCP project — so the UI and
tool layer never need to know which is active. The UI is a three-column split screen (grid
/ judge guide + action card / agent chat) that reflows to two columns on tablets and one on
phones.

Policy-rule *authoring* is natural language; policy-rule *execution* deliberately isn't.
`add_policy_rule` takes a plain-English request and Gemini's function call resolves it into
a fixed, typed condition (`resolveCinemaPolicyRule`) — every future match against that rule
runs through the same deterministic `matches()` the rest of `grid-engine.ts` already uses,
with no further model call. A rule the model could silently reinterpret differently between
runs isn't something you can safely wire to real infrastructure, so once a rule exists it
behaves exactly like hand-written code — reproducible and auditable, not "elastic." The
honest trade-off today: the natural-language grammar only accepts one flat condition (a
single field/operator/threshold), not the full AND/OR/NOT trees `grid-engine.ts` already
supports for hand-authored rules (see the compound conditions in `DEFAULT_POLICY_RULES`) —
widening that grammar so an operator's own compound, context-aware rules reach the same
engine is the natural next step, not a re-architecture.

## Accomplishments

- Six MCP tools shared identically between native WebMCP and an in-app Gemini chat loop.
- Structural safety: the execute step is unreachable by the model, only by a human click.
- Natural-language rule authoring that compiles to a fixed, deterministic condition — no
  hidden model re-interpretation once a policy rule is live.
- Domain-agnostic query/action engine, proven with one domain and designed for a second.
- A one-click, repeatable, judge-facing demo path with live progress tracking.
- A distinctive "master control room" UI (IBM Plex Mono/Sans, phosphor-teal status system)
  built with the `frontend-design` skill, responsive from phone through desktop.

## How to test

Open the live app. In the **Judge Demo Guide** panel, either click **Run full scenario**
(runs the filter → verify → preview steps automatically, then stops), or work through the
four steps manually with the **Send to chat** buttons. When the action card appears, click
**Approve & Execute** yourself — that's the human-confirmation step the scenario is built
around. `STREAM-CDN-804` is a deterministic seeded incident record, so the scenario is
reproducible on every session.

No Gemini key is needed to test the live app — it's already configured server-side. A key
is only needed to run the repo locally instead; see "Getting started" in `README.md` for
exactly where to paste it (`.env.local`, `GEMINI_API_KEY=`).

## What's next

Get `agent-builder` onto the live Vercel deployment, not just local dev — that means either
getting the `iam.disableServiceAccountKeyCreation` org policy lifted (needs an Organization
Policy Administrator, not just a project Owner) or implementing Workload Identity Federation
for Vercel's serverless environment. `lib/partner-mcp.ts` has the same "real integration"
seam already proven out end-to-end for ClickHouse; adding a real Grafana client behind it is
the same shape of work, not a new pattern. Then implement the second domain
(Healthcare/Radiology worklist) that this engine was designed to support.

Widen `add_policy_rule`'s grammar from a single flat condition to the same compound
AND/OR/NOT trees `grid-engine.ts` already evaluates for hand-authored rules, so an operator
can register something like "be more sensitive to quality drops on premium Sunday
broadcasts than on night reruns" directly from chat. Separately, a genuinely new engine
capability — staged, timed remediation ("try a lighter fix first; escalate only if it
hasn't helped within N seconds") — would need real state tracking per record across ticks,
which the current stateless-per-tick evaluator doesn't have yet.
