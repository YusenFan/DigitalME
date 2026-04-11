# Product Boundary — Persona Engine (Working Title)

> Open-source, local-first, personalized behavioral model system.
> "A brain that truly understands you — and keeps learning."

---

## Core Positioning

**What it is:** A persona-first system that actively builds and evolves a user behavioral model from directories, browser activity, and conversations. Chat is the consumption interface; the persona is the product.

**What it is NOT:** A general-purpose AI assistant platform. Not a productivity tracker. Not an analytics dashboard.

**Key differentiator vs OpenClaw:** OpenClaw is "an assistant that remembers you" (passive, conversation-driven). This project is "a system that actively understands you" (active collection, behavioral inference). It can also serve as an upstream persona source for OpenClaw or any other AI system.

---

## System Architecture

```
┌──────────────── Input Sources ─────────────────┐
│                                                 │
│  1. Onboarding + Directory scan (initialization)│
│     → questionnaire (occupation, interests)     │
│     → tree structure + key files                │
│     → combined LLM analysis → initial USER.md   │
│                                                 │
│  2. Browser extension (continuous, Level 2)     │
│     → URL, title, content excerpt               │
│       (Readability.js local extraction)         │
│     → dwell time, tab switches                  │
│     → sent via Local HTTP API to daemon         │
│                                                 │
│  3. Chat conversations (continuous)             │
│     → user questions, topics discussed          │
│                                                 │
└──────────────────┬──────────────────────────────┘
                   │
          Raw Storage (no LLM, zero API cost)
          - events.sqlite: all events stored as-is
          - basic metadata computed locally:
            dwell time, context switches, session count
                   │
          Dreaming (nightly by default OR manual trigger)
          (LLM agent batch processing)
            ├── Content-based classification (using excerpts)
            ├── Controlled tag vocabulary
            ├── Infer behavioral patterns
            ├── Decay stale memories (temporal half-life)
            ├── Compress & refine USER.md
            └── Organize memory/ by category
                   │
        ┌──────────┴──────────┐
     USER.md              memory/
     (abstract             (detailed memories,
      persona)              vector-searchable,
                            by category)
        └──────────┬──────────┘
                   │
              Chat Interface
        (USER.md + relevant memory/ injected
         into system prompt via remote API)
```

---

## Onboarding Flow (Initialization)

Directory scan and onboarding questionnaire run as one combined step.
LLM receives both user answers and directory analysis together for richer initial persona.

```
Step 1: Basic questions (name, occupation, interests, timezone)
Step 2: "Select your working directories"
Step 3: Scan directories + LLM analysis (simultaneous)
        - directory tree structure
        - key files: README.md, package.json, .gitignore, doc headings
        - combined with Step 1 answers for context
Step 4: Present initial USER.md for user review/edit
Step 5: Browser extension install guide
Step 6: Daemon starts
```

User directories typically don't change much, so this scan is primarily a one-time initialization step.

---

## Data Layer Design

### USER.md — Abstract Persona (always in system prompt)

Inspired by OpenClaw USER template. High-level, abstract facts about the user.
Populated initially via onboarding, evolved by dreaming agent over time.

```markdown
# USER.md — About You

_Learn about yourself through your digital footprint. Updated over time._

- **Name:**
- **Preferred name:**
- **Pronouns:**
- **Timezone:**
- **Occupation:**

## Identity Tags
<!-- multi-dimensional tagging, agent-managed -->
- Roles: [engineer, founder, mentor]
- Skills: [React, Python, system design]
- Learning: [Rust, async programming]
- Interests: [AI agents, photography, climbing]

## Behavioral Patterns
- Deep work: weekday mornings (9-12), primarily coding
- Research mode: evenings, broad topic exploration
- Context switching: moderate (~15 switches/day)
- Preferred tools: VS Code, Chrome, Figma

## Current Context
- Active project: [persona-engine]
- Recent focus: product scoping, PRD writing
- Upcoming: v1 architecture design

## Notes
<!-- personality, preferences, quirks — built over time -->

---
The more you know, the better you can help.
But remember — you're learning about a person, not building a dossier.
```

**Constraints:**
- Token budget: ~2000-4000 tokens max
- Dreaming agent responsible for compression and prioritization
- Stale items decayed and eventually removed
- USER.md does NOT store detailed data — only abstract facts and patterns

### memory/ — Detailed Memories (vector-searchable)

Organized by agent-managed categories:

```
memory/
├── coding/
│   ├── rust-learning.md
│   ├── react-patterns.md
│   └── debugging-sessions.md
├── research/
│   ├── ai-agents.md
│   └── persona-systems.md
├── projects/
│   ├── persona-engine.md
│   └── client-project-x.md
├── interests/
│   ├── photography.md
│   └── climbing.md
└── meta/
    ├── dreaming-log.md
    └── pattern-changelog.md
```

**Rules:**
- Agent creates new categories when no existing one fits
- Each .md file has YAML frontmatter with tags, last_updated, decay_weight
- Vector embeddings indexed for semantic search
- Chat interface queries memory/ when USER.md lacks detail

---

## Processing Pipeline

### Daytime: Raw Collection (zero LLM cost)

During the day, the system collects events and computes only local metadata.
No classification, no LLM calls.

**Browser extension extracts locally:**

| Field | Source | Method |
|-------|--------|--------|
| URL | `window.location.href` | Direct |
| Title | `document.title` | Direct |
| Content excerpt | Page body | Readability.js (Mozilla algorithm, clean article text) |
| Dwell time | Tab focus tracking | `visibilitychange` + timer |
| Tab switches | Tab activation events | `chrome.tabs.onActivated` |

**Event payload sent to daemon (via Local HTTP API):**

```json
{
  "url": "https://docs.rs/tokio/latest/tokio/runtime",
  "title": "tokio::runtime - Rust",
  "excerpt": "A runtime for writing reliable, asynchronous, and slim applications with the Rust programming language...",
  "dwell_time_sec": 180,
  "timestamp": "2026-04-11T14:32:00Z",
  "event_type": "page_visit"
}
```

All events stored in `events.sqlite` with `status: pending`.

**Locally computed metadata (no LLM):**
- Dwell time per page
- Context switch count and frequency
- Session duration
- Deep read detection (dwell time > 5min threshold)

### Dreaming: LLM Batch Processing

**Trigger:** Nightly by default (user's sleep time, configurable via cron) OR manual trigger anytime.

```bash
persona dream              # manual trigger, process all pending
persona dream --since 2h   # only process last 2 hours
persona status             # view current state
```

**Content-Based Classification:**

All classification is based on page content excerpts (extracted by Readability.js), not URL/domain heuristics. Content is the true signal — the same domain can host completely different topics.

**Controlled Tag Vocabulary:**

To prevent tag fragmentation (e.g., "frontend-dev" vs "front-end" vs "前端开发"), the dreaming agent always receives the full list of existing tags as context:

```
System prompt for dreaming classification:

You are a classification agent. Here are all existing category tags:
[coding/rust, coding/react, design/ui, research/ai-agents, ...]

Classify the following browsing events based on their CONTENT.
Reuse existing tags whenever possible.
Only create a new tag if no existing tag fits, and explain why.

Events:
1. { title: "...", excerpt: "...", dwell_time: ... }
2. ...
```

This ensures tag consistency: LLM reuses existing vocabulary, new tags only when genuinely needed.

**Dreaming Tasks (in order):**

1. **Classify** — content-based categorization of all pending events using controlled tag vocabulary
2. **Infer** — detect patterns across events (e.g., "3 consecutive days of Rust content → learning new language")
3. **Update USER.md** — refine abstract persona, add/remove tags, update current context
4. **Update memory/** — write new memory entries, merge related ones, create new category dirs if needed
5. **Decay** — reduce weight of stale memories (configurable half-life, default 30 days, ref: OpenClaw temporalDecay)
6. **Compress** — keep USER.md within token budget by summarizing or removing low-weight items

**Output:** Dreaming report logged to terminal + stored in `memory/meta/dreaming-log.md`

---

## Browser Extension ↔ Daemon Communication

**Protocol: Local HTTP API**

Daemon runs an HTTP server on `http://127.0.0.1:{port}/api`.
Extension sends events via POST requests.

```
Browser Extension ──POST──→ http://127.0.0.1:19000/api/events ──→ Daemon
                                                                     │
                                                                events.sqlite
```

**Why this approach:**
- Manifest V3 fully compatible (no WebSocket lifecycle issues)
- Simplest implementation
- Data flow is one-directional (extension → daemon), no need for daemon to push back
- Easy to debug (standard HTTP)

**Endpoints:**

```
POST /api/events          — submit browser event
GET  /api/status          — daemon health check
POST /api/events/batch    — submit multiple events at once
```

**Extension architecture:**

```
content_script.js
  → Readability.js extracts clean article text
  → Computes excerpt (first 500-1000 chars of clean text)

background.js (service worker)
  → Tracks tab focus, dwell time, switches
  → Batches events (e.g., every 30 seconds)
  → POST to daemon HTTP API
```

---

## Chat Interface

**Dual purpose:**
- **A) Self-reflection:** User queries their own persona ("What have I been focused on?", "What are my work patterns?")
- **B) Persona-aware assistant:** USER.md + relevant memory/ chunks injected into system prompt, making the AI deeply context-aware

**Implementation:**
- Terminal-based for v1
- Each API call includes USER.md as system prompt
- For detailed queries, vector-search memory/ and inject relevant chunks
- Chat history also feeds back into events.sqlite for dreaming

---

## Runtime

### Form Factor
- **v1:** Local daemon (terminal), all tasks visualized in real-time
- Browser extension (Chrome) as companion
- Chat interface integrated in terminal

### LLM Dependency
- Remote API (user provides their own key: OpenAI, Anthropic, etc.)
- **Used ONLY for:** dreaming batch processing, chat responses, initial onboarding analysis
- **NOT used during daytime** — zero API cost between dreaming runs

### CLI Commands

```bash
persona start              # start daemon
persona stop               # stop daemon
persona status             # current state, pending events, last dreaming
persona dream              # manual trigger dreaming
persona dream --since 2h   # dreaming for recent events only
persona chat               # open chat interface
persona user               # view/edit USER.md
persona memory             # browse memory/ directory
persona events             # query events.sqlite
```

### Data Sovereignty
- All data stored locally
- No cloud sync, no telemetry
- User owns everything: events.sqlite, USER.md, memory/

---

## Terminal Visualization

Daytime display focuses on raw events + local metadata (no classification).
Classification results shown after dreaming runs.

```
╔══════════════════════════════════════════════════════════╗
║  Persona Engine v0.1.0  ·  daemon running                ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  [14:32] 📥 stackoverflow.com/questions/rust-lifetime    ║
║          dwell: 5m 12s · deep read                       ║
║  [14:38] 📥 docs.rs/tokio/runtime                        ║
║          dwell: 3m 04s                                   ║
║  [14:41] 🔄 context switch: Chrome → VS Code             ║
║  [14:55] 📥 youtube.com/watch?v=...                      ║
║          dwell: 12m 30s · deep read                      ║
║  [15:01] 💬 chat: "how does tokio scheduler work?"       ║
║                                                          ║
║  ── Today ────────────────────────────────────────────   ║
║  Events: 47 · Deep reads: 8 · Context switches: 12      ║
║  Total browse time: 3h 24m · Chat messages: 5            ║
║  Pending classification: 47                              ║
║                                                          ║
║  ── Dreaming ─────────────────────────────────────────   ║
║  Last run: yesterday 23:00 (classified 156 events)       ║
║  Next: tonight 23:00 · or type 'persona dream' to run    ║
║                                                          ║
║  💬 Press [c] to chat · [d] to dream now · [s] status    ║
╚══════════════════════════════════════════════════════════╝
```

After dreaming:

```
║  🧠 Dreaming started at 23:00...                         ║
║  🧠 Classifying 47 events by content...                  ║
║  🧠 Tags used: coding/rust (23), research/ai (11),       ║
║     interests/photography (5), NEW: devops/docker (3),    ║
║     other (5)                                            ║
║  🧠 Pattern detected: "Rust learning streak — day 4"     ║
║  🧠 USER.md updated: Learning → added "Rust"             ║
║  🧠 memory/coding/rust-learning.md updated (8 new entries)║
║  🧠 Decay: memory/design/figma-plugins.md weight -20%    ║
║  ✅ Dreaming complete (47 events, 2m 13s, ~$0.03)        ║
```

---

## Consent & Privacy Model

- All monitoring requires explicit user opt-in during onboarding
- Browser extension: user controls which domains are tracked (allowlist/blocklist)
- Directory scan: user selects directories explicitly
- User can pause/resume collection at any time
- User can view, edit, or delete any data (events, USER.md, memory/)
- No data leaves the machine except API calls for LLM inference (user's own key)
- Content excerpts extracted locally in browser via Readability.js — raw page content never sent to any external service

---

## Scope: v1 vs Future

### v1 (MVP)
- [ ] Onboarding flow (questionnaire + directory scan combined → initial USER.md)
- [ ] Directory scanner (tree + key files, runs during onboarding)
- [ ] Browser extension (Chrome, Readability.js extraction, Local HTTP API to daemon)
- [ ] events.sqlite storage (raw events + local metadata, pending classification)
- [ ] Dreaming agent (nightly + manual trigger, content-based classification, controlled tag vocabulary)
- [ ] USER.md generation and maintenance (abstract persona, token-budgeted)
- [ ] memory/ directory (category-organized, vector-searchable)
- [ ] Temporal decay mechanism (configurable half-life, default 30 days)
- [ ] Chat interface (terminal-based, dual-purpose: self-reflection + persona-aware assistant)
- [ ] Terminal daemon with real-time event visualization
- [ ] CLI commands (start, stop, status, dream, chat, user, memory)

### Future (not v1)
- Web UI dashboard
- Multi-device sync (encrypted)
- Persona export (portable USER.md for other AI systems)
- Plugin system for additional input sources (IDE, calendar, email)
- Collaborative personas (team behavioral models)
- Firefox extension
- MCP server (expose persona to external agents)

---

## Open Questions for PRD Phase

1. **Tech stack decision:** Node.js (aligns with OpenClaw ecosystem) vs Python (better ML/NLP libraries)?
2. **Embedding model choice:** Which model for memory/ vector search? Local (free, slower) vs API (cost, faster)?
3. **Chat UI:** Terminal-only for v1, or include a minimal local web UI?
4. **Extension distribution:** Chrome Web Store or sideload-only for v1?
5. **Project name:** TBD