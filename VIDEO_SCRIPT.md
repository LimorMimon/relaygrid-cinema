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
   Grafana are equally real in this project, but the form only allows one select, and
   Grafana fits this project's domain (media-ops dashboards/alerting) more naturally — see
   SUBMISSION.md's "What's next" section. **Segment 5 below should show the Grafana tab**,
   not ClickHouse. ClickHouse stays fully implemented and tested in the repo; it's simply
   not the declared track — feel free to mention that in passing on camera if it fits
   naturally (it's a genuine strength — "same integration pattern, two real partners"), but
   Grafana is the one that needs the dedicated close-up.
3. **Re-verify `agent-builder` still authenticates.** It depends on
   `gcloud auth application-default login` having a live token — that can expire between
   sessions. Run it locally with `AGENT_BACKEND=agent-builder` and ask one question before
   you're recording for real, not during the take.
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

## Shot list (target ~2:50 total)

Each beat: **[on-screen action]** — *caption/narration line* — why it's here.

**0:00–0:12 — Open**
**[App loads. Header badges visible: "WebMCP Live", the Gemini/Google Cloud badge.]**
*"RelayGrid Cinema — a shared human-agent control room for 220 live media streams."*
Establishes the product in one shot; the header badges are already proof-of-life for later.

**0:12–0:30 — The problem**
**[Scroll the grid briefly — 220 rows, CDN/bitrate/audio/subtitle columns visible.]**
*"An operator can't manually correlate bitrate, audio, and subtitle faults across a fleet
this size. RelayGrid's agent does — through real MCP tool calls, not a script."*
Sets up "Potential Impact" (real problem, real audience) before touching a single button.

**0:30–1:00 — Live agentic query (Technological Implementation)**
**[Open the Judge Demo Guide panel → click "Send to chat" on step 1: "Show streams with
bitrate below 3Mbps or audio/subtitle sync issues in the last 24h."]**
*"Ask in plain language — Gemini calls the grid's own MCP tool live, and the view updates
in real time."*
**[Grid filters down; STREAM-CDN-804 is now visible/flagged.]**
This is the first proof it's a real function call, not a canned filter — the result changes
because Gemini actually called `apply_query`.

**1:00–1:30 — Explain + non-mutating preview (the safety story)**
**[Steps 2–3 of the guide: verify the flagged stream, then preview the remediation.]**
*"Gemini explains why this stream matched, then prepares a fix — but nothing changes yet."*
**[The "MCP Action Preview — no changes made" card appears.]**
This card's own copy already says "no changes made" on screen — let it read itself; don't
over-narrate it.

**1:30–2:00 — Human approval, and the unscripted moment**
**[Click "Approve & Execute" on the action card, live, on camera.]**
*"A human has to click this. Gemini can prepare a fix; it can never execute one."*
**[Change applies — Actions Executed counter increments, chat logs the result. Watch for
a NEW action card to appear a moment later — approving this fix satisfies a *different*
policy rule's condition (Rule #6, a compound "second independent fault" check) on the same
record, so the engine escalates a fresh approval card live.]**
*"Fixing this just satisfied a second, different rule — the engine reacted to real state,
not a scripted sequence."*
This is the strongest "Quality of the Idea" / "non-obvious" moment available in the app
right now — it happened by accident in testing and is genuinely the policy engine reasoning
over live state, not a demo trick. Worth calling out explicitly rather than treating it as
noise.

**2:00–2:25 — Partner Track proof (pass/fail requirement — do not cut for time)**
**[Open Integrations → the Grafana tab (the declared track). Point out the green "Live —
Written to real Grafana Cloud" badge, click a log line to expand its real payload.]**
*"Every action is also written into a real Grafana Cloud Loki stream — not a mock."*
**[If feasible: cut or split-screen to the actual Grafana Cloud Explore view, showing the
same log line having just landed there.]** This external confirmation is worth the extra
editing effort — it's the single clearest piece of evidence
for the "actively use Grafana at runtime" pass/fail check, stronger than anything the
app's own UI can claim about itself.

**2:25–2:45 — Google Cloud Agent Builder proof (pass/fail requirement — do not cut for
time; this is the highest-risk requirement for this submission)**
**[Locally: flip to `AGENT_BACKEND=agent-builder`, reload. Header badge changes to
"Google Cloud · Vertex AI" with a pulsing dot. Ask one short question in chat.]**
*"The same agent, now running through Google Cloud Agent Builder on Vertex AI instead of
the public API — same tools, same safety model."*
**[If feasible: split-screen with Google Cloud Console's Vertex AI API metrics showing the
live request. This isn't just supporting color — it's the best available evidence that the
hosted Vercel URL's `gemini-direct` default doesn't fully show on its own; see
SUBMISSION.md's own gap note on why the public URL can't run this backend yet.]**

**2:45–2:50 — Close**
**[One more wide shot of the full three-column layout.]**
*"One domain today — media operations. The same engine is built to carry a second, like
healthcare, tomorrow."*

## Requirements checklist — cross-checked against the live rules page

| Requirement | Status |
|---|---|
| Hosted, functioning project URL | ✅ https://relaygrid-cinema.vercel.app |
| Public repo with all source/assets/instructions | ✅ repo has a LICENSE (MIT, on origin, shows in GitHub's About sidebar), and `origin/main` is now up to date with local |
| Repo demonstrably calls an accepted Google Cloud SDK (`google-genai`/etc.) at runtime | ✅ both `gemini-direct` and `agent-builder` backends call `@google/genai` |
| "Powered by ... Google Cloud Agent Builder" (the stronger, literal reading in the challenge brief) | ⚠️ real and working, **locally only** — not on the public URL (infra gap, documented in SUBMISSION.md). The video's segment 7 is currently the only place this gets demonstrated at all — treat it as mandatory, not optional, in editing |
| Partner Track: pick one, demonstrate real runtime use | ✅ **Grafana Labs — decided and declared.** Real runtime use confirmed live (81 `mcp-grafana` tools, real Loki writes). ClickHouse is also real and tested in the repo, just not the declared track |
| Text description (summary, tech, learnings) | ✅ drafted in SUBMISSION.md, ready to paste |
| Demo video, ≤3 min, YouTube/Vimeo, public, English/subtitles | ❌ not recorded yet — this file |
| Devpost submission form completed | ❌ not submitted yet |
| Team size ≤4 | ✅ (solo) |

No blockers found beyond the ❌/⚠️ rows above — everything else the rules ask for is
already true of the project as it stands.
