# Devpost submission draft — Agentic Cinema hackathon

Copy these into the Devpost submission form fields when you submit. This file is a staging
draft, not the submission itself — it lives in the repo for convenience, nothing here is
sent anywhere automatically.

## ⚠ Before you submit — not yet done

- [ ] **3-Minute Trailer (Demo Video)** — required, not recorded yet. Upload to YouTube or
      Vimeo (public, English or English subtitles) and paste the link below.
- [ ] **Partner Track** — mandatory selection (IBM / Grafana Labs / Parallel / ClickHouse /
      Replit) with real runtime integration in the code. Not chosen or integrated yet.
- [ ] **Google Cloud Agent Builder / Gemini Enterprise Agent Platform** — the app currently
      calls the public Gemini API directly (`lib/agent-backends/gemini-direct.ts`), not
      through Agent Builder. `lib/agent-backends/agent-builder.ts` is the seam for this but
      isn't implemented. This is a mandatory stack requirement, independent of partner track.

Submitting before these are done risks disqualification on "Technological Implementation"
— see the earlier gap analysis in `README.md`.

## Project links

- **Live app:** https://relaygrid-cinema.vercel.app
- **Public source:** https://github.com/LimorMimon/relaygrid-cinema
- **Demo video:** _(not recorded yet)_
- **Partner track:** _(not yet selected)_

## One-line summary

**RelayGrid Cinema turns a media-ops control room into a shared human-agent surface: Gemini reasons over the live stream grid through MCP tool calls, while every mutating action stays behind an explicit human "Approve & Execute" click.**

## Inspiration

Streaming/CDN infrastructure already does *some* self-healing — AWS Elemental MediaLive can
auto-failover on audio loss, multi-CDN setups auto-reroute around a degraded network. But
that automation is rigid and per-stream: a fixed threshold on one signal, no view of the
fleet as a whole, and nothing you can question or reason with. The operator watching
hundreds of streams still has to notice the pattern by hand — cross-referencing bitrate,
audio, and subtitle telemetry across streams — before any of that automation even applies.

RelayGrid Cinema isn't another rigid rule-based failover trigger. It's the reasoning layer
*above* that infrastructure: an agent that understands the whole grid, investigates a fault
in plain language, and turns raw telemetry into an explained, ready-to-approve fix instead
of a fixed if-audio-silent-then-failover rule. The risk of an agent this capable is letting
it also *apply* the fix without a human actually looking at what will change — which is why
every mutating action stays behind an explicit human "Approve & Execute" click.

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
a swappable `lib/agent-backends/` interface so the current direct-API implementation can be
replaced by a Google Cloud Agent Builder backend later without touching the UI or the tool
layer. The UI is a three-column split screen (grid / judge guide + action card / agent
chat) that reflows to two columns on tablets and one on phones.

## Accomplishments

- Six MCP tools shared identically between native WebMCP and an in-app Gemini chat loop.
- Structural safety: the execute step is unreachable by the model, only by a human click.
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

Wire `lib/agent-backends/agent-builder.ts` to a real Google Cloud Agent Builder / Gemini
Enterprise Agent Platform integration, and `lib/partner-mcp.ts` to a chosen Partner Track's
MCP server (Grafana Labs is a natural fit for streaming telemetry) — both are seams that
were built into the architecture from the start specifically so this swap wouldn't require
touching the UI, the domain engine, or the tool layer. Then implement the second domain
(Healthcare/Radiology worklist) that this engine was designed to support.
