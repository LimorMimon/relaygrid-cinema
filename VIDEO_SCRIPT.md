# Demo video script — Agentic Cinema hackathon

Verified against the live rules pages (agentic-cinema.devpost.com and its /rules page) on
2026-09-05. This file is a production plan, not submission-form content — see SUBMISSION.md
for the text that actually goes into the Devpost form fields.

## Hard constraints (from the rules page — do not violate any of these)

- **Deadline: September 9, 2026, 2:00pm PDT.** Today is 2026-09-05 — ~4 days left.
- **Length: 3 minutes max.** If longer, only the first 3 minutes are evaluated — pace to
  land at ~2:50, not exactly 3:00, so nothing important gets cut by accident.
- **Hosting: YouTube or Vimeo, publicly visible.** Not unlisted-only, not a Drive link.
- **Language: English, or English subtitles.** Burned-in on-screen captions satisfy this
  even without spoken narration — see "Narration vs. captions" below.
- **Content must show the project actually functioning** — "footage that shows the Project
  functioning on the platform(s) for which it was built." Not a cinematic trailer, not
  slides-only. Every beat below is a real click producing a real, visible result.
- Must be original work, nothing derogatory/offensive, no third-party copyrighted content
  (music included — see "Narration vs. captions").

## Before you record — do these first, in order

1. **Push to GitHub.** ✅ Done — `origin/main` is up to date with local.
2. **Partner Track for the Devpost form: Grafana Labs — decided.** Both ClickHouse and
   Grafana are equally real in this project and both are now live on the public URL, but the
   form only allows one select, and Grafana fits this project's domain (media-ops
   dashboards/alerting) more naturally — see SUBMISSION.md's "What's next" section.
   **Segment 5 below should show the Grafana tab**, not ClickHouse — it's simply not the
   declared track. Feel free to mention ClickHouse in passing on camera if it fits naturally
   (it's a genuine strength — "same seam, two real partners, both live on this exact URL"),
   but Grafana is the one that needs the dedicated close-up.
3. **✅ Nothing to do here anymore.** The live public URL now runs `agent-builder` by
   default (Workload Identity Federation, no local switch needed — see SUBMISSION.md). The
   header badge already reads "Google Cloud · Vertex AI" from the very first shot. The
   whole video can be recorded from `relaygrid-cinema.vercel.app` in one continuous take —
   no cutting to a local dev window for this anymore. Just do one quick sanity check right
   before recording: open the live site and confirm the header badge is there and a chat
   message comes back tagged "via Google Cloud · Vertex AI".
4. **Start from a clean state.** Click **Reset Session** (or do a hard browser refresh)
   right before you hit record, so the grid is back to its canonical seeded state —
   `STREAM-CDN-804` is the deterministic seeded incident this whole script is built around.
5. **Decide: narration vs. captions** (see below) and prep whichever you pick.

### Narration vs. captions

Two ways to satisfy "English or English subtitles":
- **Spoken English narration**, recorded live or dubbed after — most natural if you're
  comfortable narrating in English on the spot.
- **On-screen text captions only, no spoken audio** (or ambient/silent screen recording) —
  fully satisfies the rule on its own ("include English subtitles"), and sidesteps both the
  narration-timing pressure and any copyrighted background-music question (don't add music
  from an unlicensed source either way). Recommended if English narration under time
  pressure feels risky — the script below is written so every beat's on-screen text line can
  stand alone as a caption.

## Shot list v2 (target ~2:50 total — revised to add automation-tier + policy/report
authoring content on top of the v1 take, faster caption pacing throughout)

Rationale for the reorganization: v1 (the recorded 2:11 take) proved the core loop works
and captured both pass/fail proofs cleanly — none of that moves. What's new is three
things the judges can't currently see: (1) that most fixes never reach a human at all,
(2) that the policy engine's rule set is itself editable/extensible live, not fixed at
launch, and (3) that the same is true of analytics — a report can be composed in plain
English on the spot, not just picked from a canned list. All three are placed as ONE
contiguous "how the system governs itself" block, inserted after the cascade moment and
before the two required partner/cloud proofs — right where the video pivots from
"watch it handle one incident" to "here's the machinery behind that," which is also the
natural lead-in to "and here's the real infrastructure underneath" (Grafana/Google Cloud).
The automation-tier contrast (item 1) is pulled forward to right after "The problem"
instead, because it's free (zero new clicks — reuses on-screen state already visible at
load) and it sets up vocabulary ("AUTO" vs "APPROVAL" badges) that the new policy-rule beat
then pays off. Caption holds throughout are ~2.5s (~2s for short lines) instead of ~4s.

Each beat: **[on-screen action]** — *caption line* — why it's here.

**0:00–0:10 — Open**
**[App loads at relaygrid-cinema.vercel.app. Header badges visible: "WebMCP Live" and
"Google Cloud · Vertex AI" with its pulsing dot.]**
*"RelayGrid Cinema — a shared human-agent control room for 220 live media streams."*
Establishes the product in one shot; the header badges are already proof-of-life for later.

**0:10–0:24 — The problem**
**[Scroll the grid briefly — 220 rows, CDN/bitrate/audio/subtitle columns visible.]**
*"An operator can't manually correlate bitrate, audio, and subtitle faults across a fleet
this size. RelayGrid's agent does — through real MCP tool calls, not a script."*

**0:24–0:38 — Automation has two tiers (NEW, zero new clicks)**
**[Point at an existing row already carrying an "AUTO-RESOLVED" badge, and an
"Auto-executed: ..." line already sitting in the Agent Chat log from page load. No click
needed — this state exists from the moment the session was seeded.]**
*"Not everything needs a human. Simple, reversible fixes — like restarting a stuck audio
encoder — the policy engine just does, and logs. Anything riskier stops and waits for you."*
This is the cheapest possible new beat (nothing to click, nothing to break) and it plants
the AUTO/APPROVAL vocabulary the policy-rule beat below reuses instead of re-explaining.

**0:38–1:05 — Live agentic query (Technological Implementation)**
**[Open the Judge Demo Guide panel → click "Send to chat" on step 1: "Show streams with
bitrate below 3Mbps or audio/subtitle sync issues in the last 24h."]**
*"Ask in plain language — Gemini calls the grid's own MCP tool live, and the view updates
in real time."*
**[Grid filters down; STREAM-CDN-804 is now visible/flagged.]**

**1:05–1:28 — Explain + non-mutating preview (the safety story)**
**[Steps 2–3 of the guide: verify the flagged stream, then preview the remediation.]**
*"Gemini explains why this stream matched, then prepares a fix — but nothing changes yet."*
**[The "MCP Action Preview — no changes made" card appears.]**
Let the card's own on-screen copy read itself; don't over-narrate it.

**1:28–1:55 — Human approval, and the unscripted moment**
**[Click "Approve & Execute" on the action card, live, on camera — white pulse highlight
on the click.]**
*"A human has to click this. Gemini can prepare a fix; it can never execute one."*
**[Change applies — Actions Executed counter increments. A NEW, visibly different action
card appears a moment later — teal row-highlight + caption proving it's a distinct
approval, not the one just clicked. Approving the first fix satisfied a second, different
policy rule's condition on the same record.]**
*"Fixing this just satisfied a second, different rule — the engine reacted to real state,
not a scripted sequence."*
Strongest "Quality of the Idea" moment in the app — keep this exactly as recorded in v1.

**1:55–2:20 — The rule set is editable, live (NEW)**
**[Integrations-adjacent panel: Policy Rules tab → "Suggested" sub-tab. Point at a
candidate rule card: description, an AUTO or APPROVAL badge, a real "MATCHES N STREAMS
NOW" count computed from live data — not canned text.]**
*"Suggestions aren't fixed at launch either — the engine keeps proposing new rules from
whatever's actually happening in the fleet right now."*
**[Click "+ Add" on the AUTO-tagged suggestion ("Subtitles missing entirely → auto-resync
the subtitle track"). It moves into Active immediately.]**
*"Add one, and — because this one's tagged AUTO — it can fire on a matching stream
immediately, with no approval step."*
**[If a matching stream picks up a fresh "AUTO-RESOLVED" badge on the grid within a second
or two of the click — it does, reliably, against the seeded data — hold on it briefly.]**
This directly demonstrates items (1) and (2) from the automation-tier beat above acting
together: adding a rule is itself the "configure the automation" moment, and an AUTO rule
proves its own tier by firing with no click at all.

**2:20–2:42 — Reports: compose one live, then run an existing one (NEW)**
**[Reports tab. Type a plain-English description into the "Describe a report" box — e.g.
"Streams with low bitrate, grouped by CDN provider, last 24 hours" — click Generate.]**
*"Same idea for analytics — describe what you want, Gemini configures the query."*
**[The report result opens immediately: a real total, grouped bars with live counts.]**
**[Click one of the group rows (e.g. "EU-West") to expand it into detailed mode — the
actual matching stream IDs in that group, not just the count.]**
*"It's not just a number — click into any group and see exactly which streams it means."*
This is the step that makes the report feel real rather than decorative: a judge can see
the aggregate claim ("2 streams in EU-West") cash out into actual record IDs on demand.
**[Cut to the Active tab → click "Run Report" on one of the existing saved reports (e.g.
"Degraded or failing streams by Channel / Program"). Click one of ITS group rows too, to
show the same detailed drill-down works here as well — a different group than the one
opened above, so it doesn't look like a repeat of the same click.]**
*"Saved reports run the exact same way — same engine, same live data, just already
named and kept around."*
Fast cut is fine here — the point is "compose-now" and "already-saved" hit the identical
mechanism (drill-down included), which is the actual technical claim worth making.

**2:42–3:02 — Partner Track proof (pass/fail requirement — do not cut for time)**
**[Open Integrations → the Grafana tab (the declared track). Point out the green "Live —
Written to real Grafana Cloud" badge, click a log line to expand its real payload.]**
*"Every action is written live into a real Grafana Cloud Loki stream, right now — not a
mock, not a replay."*
**[If feasible: cut or split-screen to the actual Grafana Cloud Explore view, showing the
same log line having just landed there.]**

**3:02–3:20 — this overshoots 3:00; see "Fitting back under 3:00" below.**

## Fitting back under 3:00 (hard cap — the rules page enforces this by only judging the
first 3 minutes, so this is not optional)

The block above lands at ~3:20 including both required proofs, which is ~20–30s over.
Before recording, cut from here, in this order (stop as soon as you're under ~2:50):

1. **Cut the second half of the Reports beat first** (the "run an existing report" cut) —
   it's the single most cuttable beat: it repeats a mechanism the compose-now shot already
   proved, so losing it costs no new information, only a confirmation. Saves ~8–10s.
2. **If still over, shorten the Policy Rules beat** to just the "+Add" click and the
   AUTO-badge landing — drop the opening line about suggestions being computed live and
   let the on-screen "MATCHES N STREAMS NOW" text carry that claim by itself. Saves ~5–8s.
3. **Do not cut**: the automation-tier beat (0:24–0:38, it's already the cheapest beat in
   the video), the cascade moment (1:28–1:55, the strongest idea-quality evidence), or
   either required partner/cloud proof.

The Google Cloud Agent Builder proof beat from v1 (header badge + one more tagged chat
answer, ~20s) still needs to run after the Grafana beat and before the close — budget for
it explicitly when timing the actual take; it isn't listed above only because it is
unchanged from v1 and still mandatory.

**Close (last ~5s, whatever time remains)**
**[One more wide shot of the full three-column layout.]**
*"One domain today — media operations. The same engine is built to carry a second, like
healthcare, tomorrow."*

## Requirements checklist — cross-checked against the live rules page

| Requirement | Status |
|---|---|
| Hosted, functioning project URL | ✅ https://relaygrid-cinema.vercel.app |
| Public repo with all source/assets/instructions | ✅ repo has a LICENSE (MIT, on origin, shows in GitHub's About sidebar), and `origin/main` is now up to date with local |
| Repo demonstrably calls an accepted Google Cloud SDK (`google-genai`/etc.) at runtime | ✅ both `gemini-direct` and `agent-builder` backends call `@google/genai` |
| "Powered by ... Google Cloud Agent Builder" (the stronger, literal reading in the challenge brief) | ✅ **live on the public URL itself** via Workload Identity Federation (no service-account key) — confirmed live: a real chat turn on relaygrid-cinema.vercel.app round-tripped through Vertex AI and came back tagged "via Google Cloud · Vertex AI" |
| Partner Track: pick one, demonstrate real runtime use | ✅ **Grafana Labs — declared track**, also tested on ClickHouse — **both live on the public URL itself, no restrictions**. Grafana: a vendored Linux `mcp-grafana` binary runs inside the Vercel function (real tool-calling, 81 tools) plus real Loki writes. ClickHouse: real writes via a direct call to its own HTTP interface, live in production (its MCP server is a Python venv, so its tool-calling is exercised locally instead) |
| Text description (summary, tech, learnings) | ✅ drafted in SUBMISSION.md, ready to paste |
| Demo video, ≤3 min, YouTube/Vimeo, public, English/subtitles | ❌ not recorded yet — this file |
| Devpost submission form completed | ❌ not submitted yet |
| Team size ≤4 | ✅ (solo) |

No blockers found beyond the ❌/⚠️ rows above — everything else the rules ask for is
already true of the project as it stands.
