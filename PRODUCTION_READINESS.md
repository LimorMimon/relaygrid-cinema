# Going from hackathon demo to a real environment

This project is built to demonstrate the idea end-to-end on real infrastructure (real
Vertex AI calls, real Grafana Cloud writes, real MCP tool-calling) — but several things
are deliberately shaped around *being a hackathon submission*, not around running as a
real, unattended ops tool. This file is a checklist of what to change, in rough priority
order. Nothing here blocks the Devpost submission; it's for whenever this becomes more
than a demo.

## Time-sensitive — check this first

- **Grafana Cloud free tier.** The `GrafanaPartnerMcpClient` (`lib/partner-mcp.ts`) points
  at a real Grafana Cloud stack via `GRAFANA_URL` / `GRAFANA_SERVICE_ACCOUNT_TOKEN` /
  `GRAFANA_LOKI_*` env vars — genuinely live, not mocked. But the instance behind those
  vars is on Grafana's free tier, which is a **14-day trial clock**, not a permanent free
  plan. If judges open the "Live — written to real Grafana Cloud" tab or the video's
  Grafana cutaway after that window closes, the live proof may 404 or show an expired
  workspace instead of real data.
  **Action:** either upgrade the instance to a plan that doesn't expire before the
  judging window closes, or re-provision a fresh free instance a day or two before
  judging starts and re-run enough actions to repopulate real Loki entries (re-recording
  the video is not required — only the *live app's* Grafana tab needs to still work).
  Same logic applies to any other free-tier dependency added later.

## Demo-only code paths — remove or gate before real use

- **`injectIncident` / `injectRandomIncident`** (`hooks/use-grid-agent.ts`,
  `lib/domains/cinema.ts`) is explicitly commented as a "demo-only escape hatch...
  deliberately NOT an MCP tool" that mutates a random healthy stream so a human can prove
  the policy engine reacts to new data. It's wired to a real UI button
  (`components/cinema-grid-app.tsx`, "Inject Incident"). A real ops tool has no business
  letting anyone randomly corrupt live records from the UI — remove the button and the
  hook export, or gate both behind a `NODE_ENV !== "production"` check, before this is
  anything but a demo.
- **`runFullScenario` / the Judge Demo Guide** (`components/judge-guide.tsx`,
  `GUIDE_STEPS`) auto-drives the chat through a canned prompt sequence. Harmless to leave,
  but it's demo scaffolding a real operator doesn't need — worth hiding behind the same
  flag or a settings toggle rather than deleting outright (it's genuinely useful for a
  sales/onboarding demo later).
- **`resetSession`** wipes all state back to the seeded dataset with one click. Fine for
  a demo; in a real tool this needs to not exist, or at minimum be admin-gated and
  logged — it currently discards real audit history with no confirmation.

## No persistence — everything lives in React state

Every record, audit-log entry, policy rule, saved report, and pending action lives in
`useState` inside `useGridAgent` (`hooks/use-grid-agent.ts`). A page reload loses
everything except what a real backend would call the seed data. A real environment
needs:
- A real datastore for records (replacing the generated 220-stream seed in
  `lib/domains/cinema.ts` with a live feed from actual CDN/encoder telemetry).
- Persisted audit log, policy rules, and reports (currently `audit`, `policyRules`,
  `reports`, `savedReportSpecs` are all in-memory only).
- Concurrency handling — right now two browser tabs pointed at the same deployment have
  two independent, unsynced copies of "reality."

## No auth or access control

There is no login, no session, no role separation anywhere in the app — grepped the
codebase for auth libraries and middleware and found none. Anyone with the URL can
approve/execute actions, edit or delete policy rules, and reset all state. A real
control room needs identity (who approved this?), and probably tiered permissions
(who can *author* a policy rule vs. who can only *approve* a prepared action).

## Partner integrations: real, but not equally production-shaped

- **Grafana**: real tool-calling (81 tools via the vendored `mcp-grafana` Linux binary,
  `vendor/mcp-grafana-linux-x64/`) and real Loki writes, live in the Vercel deployment.
  This one is already production-shaped, modulo the free-tier clock above.
- **ClickHouse**: the direct HTTP write path is real and live in production. Its MCP
  *tool-calling* is not — `PythonMcpClickHouseClient` spawns a Python venv subprocess
  (`.mcp-clickhouse-venv/`) that only exists for local dev, since Vercel's serverless
  functions have no Python runtime to spawn it from (documented in
  `lib/partner-mcp.ts`'s own comments). If ClickHouse tool-calling needs to be live in
  production too, either find/build a Node-native MCP client for it, or run a small
  always-on service (e.g. a tiny Cloud Run container) that Vercel can call over HTTP
  instead of spawning a local subprocess.

## Vertex AI quota

The `agent-builder` backend hit a real `RESOURCE_EXHAUSTED` (429) rate limit live during
this session's recording — a transient hackathon-project-quota issue, not a code bug.
Before relying on this for anything beyond a demo, request a quota increase on the real
GCP project (or confirm the production project already has appropriate quota) so a burst
of real operator traffic doesn't get throttled.
