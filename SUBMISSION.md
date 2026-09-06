# Devpost submission draft — Agentic Cinema hackathon

Copy these into the Devpost submission form fields when you submit. This file is a staging
draft, not the submission itself — it lives in the repo for convenience, nothing here is
sent anywhere automatically.

## ⚠ Before you submit — not yet done

Verified against the live rules pages (agentic-cinema.devpost.com + /rules) on 2026-09-05.
**Deadline: September 9, 2026, 2:00pm PDT** — ~4 days out as of this note. Full checklist
and shot-by-shot plan in `VIDEO_SCRIPT.md`; the two items below are the ones that block
submission outright.

- [x] **Push to GitHub.** Done — `origin/main` is up to date with local as of this note.
- [ ] **3-Minute Trailer (Demo Video)** — required, not recorded yet. Upload to YouTube or
      Vimeo (public, English or English subtitles) and paste the link below. See
      `VIDEO_SCRIPT.md` for the full shot list — now recordable entirely from the live
      public URL, including the Google Cloud Agent Builder segment (no local-only
      workaround needed anymore, see below).
- [x] **Partner Track for the Devpost form: Grafana Labs.** Grafana is the declared track —
      it's the closer domain fit (dashboards/alerting for a media-ops control room) per the
      reasoning in "What's next" below. **It was also tested on ClickHouse**, using the same
      seam, and both run live in production with no restrictions.
- [x] **Partner Track — technical writeup** — two real runtime integrations behind the same
      `lib/partner-mcp.ts` seam, **both live in production on `relaygrid-cinema.vercel.app`
      itself**, no local-only caveats. Grafana (**the declared track**): the official
      `mcp-grafana` MCP server runs as a vendored Linux binary inside Vercel's serverless
      functions (`vendor/mcp-grafana-linux-x64/` — Grafana Cloud's own hosted MCP endpoint
      only supports interactive OAuth today, so a self-hosted binary was the only path to a
      headless function) for real tool-calling — 81 tools registered against a real Grafana
      Cloud stack — and pushes every sponsor event directly into a real Loki stream; clicking
      `Approve & Execute` on the live public site lands real log lines in Grafana Cloud,
      badge reading "Live". ClickHouse (**also tested, not the declared track**): writes every
      sponsor event into a real `policy_events` table on ClickHouse Cloud via a direct call
      to its HTTP interface (its official MCP server is a Python venv, so tool-calling through
      it is exercised locally rather than bundled into the Vercel function) — the write path
      itself is fully live in production, verified with a 4-request concurrent burst all
      succeeding in 1.5–2.6s each. `PARTNER_MCP` runs both together on the live deployment
      (`clickhouse,grafana`) as well as locally, with each partner's failures isolated from
      the other's (`getPartnerMcpClients()` in `lib/partner-mcp.ts`) — verified with a
      deliberately broken Loki URL and an invalid partner id, both silently dropped without
      affecting anything else. The Integrations tab (`components/sponsor-integrations.tsx`)
      asks `app/api/partner-info/route.ts` which partners are truly configured and only shows
      "Live" when truly active, for both tabs — and both tabs now share the same row layout
      (metadata line + full-width message line below it, one entry per `<tbody>`).
- [x] **Google Cloud Agent Builder / Gemini Enterprise Agent Platform** — **confirmed
      working end to end on the live, public URL**, not just locally.
      `lib/agent-backends/agent-builder.ts` calls `@google/genai` with `vertexai: true`
      against a real Google Cloud project (`google-genai`/`@google/genai` is explicitly
      listed as an accepted SDK on the hackathon's rules page). The live app authenticates
      via **Workload Identity Federation** (Vercel's OIDC token exchanged for short-lived
      Google credentials via `@vercel/oidc` + `google-auth-library`'s
      `ExternalAccountClient`, in `lib/agent-backends/agent-builder.ts`) — no
      service-account key is ever created or stored, which is what makes this possible at
      all: this GCP project enforces `iam.disableServiceAccountKeyCreation`, blocking key
      creation outright. Confirmed live on `relaygrid-cinema.vercel.app` itself: a real
      chat turn round-tripped through Vertex AI, called `apply_query` for real, filtered
      the live grid to 17 matching streams, and the response was tagged "via Google Cloud ·
      Vertex AI" in the UI — see the header badge, which reads "Google Cloud · Vertex AI"
      with a live pulsing dot whenever this backend is what actually served the request.
      Local dev still uses Application Default Credentials (`gcloud auth
      application-default login`) unchanged; see `.env.local.example` for exact setup
      steps for both paths, including the GCP Console steps for the Workload Identity Pool
      + provider + service-account binding.

The only remaining blocker is the demo video itself — every technical/runtime requirement
below it is done and verified live.

## Project links

- **Live app:** https://relaygrid-cinema.vercel.app
- **Public source:** https://github.com/LimorMimon/relaygrid-cinema
- **Demo video:** _(not recorded yet)_
- **Partner track:** Grafana Labs (real runtime integration — `lib/partner-mcp.ts`'s
  `GrafanaPartnerMcpClient`; the official `mcp-grafana` MCP server plus a real Loki push),
  the one declared on the submission form. Also tested on ClickHouse (same file, same
  pattern) — both run live in production at once via `PARTNER_MCP=clickhouse,grafana`.

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

The underlying pattern — a live grid governed through an MCP server — is one we'd explored
before, in an earlier personal hackathon project: a single grid, one scripted incident
scenario, no persistent automation. RelayGrid Cinema is a new codebase, written from
scratch for this contest and this domain: a standing policy engine with its own
AUTO/APPROVAL tiers and live rule authoring, a natural-language reporting layer with
drill-down, and real running integrations with both Grafana Cloud and ClickHouse, all on
top of Google Cloud Agent Builder / Vertex AI. Same instinct for the interaction model;
everything built here is new, and built for media/streaming operations specifically.

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

**A note on which backend actually runs where, so this isn't mistaken for smoke and mirrors:**
Which `AgentBackend` runs (`lib/agent-backends/`) is one line in `.env.local`/Vercel's env —
`gemini-direct` (public Gemini API) or `agent-builder` (Vertex AI on a real GCP project).
Both are real, both are fully implemented, and switching between them touches no other code
— see `lib/agent-backends/genai-shared.ts`, which both share.

- **The live app runs `agent-builder` — real Vertex AI, on the public URL itself.**
  Grafana (and ClickHouse) are genuinely live there too (check the Integrations tab — it's
  marked "Live", not "Simulated", and is really writing to Grafana Cloud/ClickHouse Cloud).
- **How, given the org policy:** this GCP project enforces `iam.disableServiceAccountKeyCreation`,
  which blocks creating a service-account key outright (even for a project Owner). Instead
  of a key, the live app uses **Workload Identity Federation** — Vercel's own OIDC token
  (`@vercel/oidc`'s `getVercelOidcToken`, scoped to this specific WIF provider's audience)
  is exchanged for short-lived Google credentials via `google-auth-library`'s
  `ExternalAccountClient` (`lib/agent-backends/agent-builder.ts`), impersonating a service
  account that has the "Agent Platform User" role. No key ever exists, on disk or in an env
  var — see the GCP Console setup steps in `.env.local.example`.
- **It is real and it was tested against the live URL itself, not just written:** a real
  chat turn against `relaygrid-cinema.vercel.app` round-tripped through Vertex AI via this
  OIDC exchange and came back with a correct, tool-calling answer (`apply_query` really ran,
  the grid really filtered to the matching streams) — confirmed live, not assumed. The
  header badge and every answer from that backend are labeled "Google Cloud · Vertex AI" in
  the UI itself (not just in server logs), specifically so this is visible on screen, not
  asserted in prose.
- **Local dev is unaffected:** Application Default Credentials (`gcloud auth
  application-default login`) still work exactly as before for running `agent-builder`
  locally — the OIDC path only activates when the `GCP_WORKLOAD_IDENTITY_POOL_ID` etc. vars
  are set, which they only need to be on Vercel.

## What's next

**Grafana is this submission's declared Partner Track** — a media-ops control room that
surfaces stream health and flags anomalies is, in substance, exactly the
dashboards-and-alerting problem Grafana exists to solve, closer to this app's own domain
than a general-purpose analytics database (ClickHouse's role here). `GrafanaPartnerMcpClient`
(`lib/partner-mcp.ts`) spawns the official `mcp-grafana` MCP server for tool-calling
(confirmed: 81 tools registered against a real stack) and pushes every sponsor-bus event
straight to Loki's push API for ingestion (confirmed: real actions in the running app landed
real log lines in Grafana Cloud), live in production. The same seam was also tested on
ClickHouse: `PARTNER_MCP` takes a comma-separated list, so ClickHouse and Grafana both run at
once by default (`clickhouse,grafana`) — confirmed live, one `Approve & Execute` click
landing a real row in both at the same time, with each partner's failures isolated from the
other's (`getPartnerMcpClients()`). Next: implement the second domain (Healthcare/Radiology
worklist) that this engine was designed to support.

Widen `add_policy_rule`'s grammar from a single flat condition to the same compound
AND/OR/NOT trees `grid-engine.ts` already evaluates for hand-authored rules, so an operator
can register something like "be more sensitive to quality drops on premium Sunday
broadcasts than on night reruns" directly from chat. Separately, a genuinely new engine
capability — staged, timed remediation ("try a lighter fix first; escalate only if it
hasn't helped within N seconds") — would need real state tracking per record across ticks,
which the current stateless-per-tick evaluator doesn't have yet.

The Judge Demo Guide's four steps are hardcoded (`GUIDE_STEPS`); the same Active/Suggested
pattern already used for Policy Rules and Reports could extend to letting an operator author
their own multi-step scenario — a saved sequence of prompts, run one at a time or all at once
— and add it alongside the built-in one. Useful for a team that wants its own repeatable
walkthrough (a specific outage playbook, an onboarding tour) without touching code.
