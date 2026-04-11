# PRD — Persona Engine v1

> Product Requirements Document
> Version: 1.0 · Date: 2026-04-11
> Status: Draft
> Reference: [product-boundary.md](./product-boundary.md)

---

## 1. Overview

### 1.1 Product Summary

Persona Engine is an open-source, local-first system that actively builds a living behavioral model of the user — a "digital twin" — by ingesting their file directories, browser activity, and chat conversations. All data stays on the user's machine. An LLM processes raw activity in nightly "dreaming" sessions to classify, infer patterns, and maintain a structured persona in markdown. The persona then feeds into a chat interface, giving any AI assistant deep context about who the user is.

### 1.2 Problem Statement

Current AI assistants start every conversation from zero. Users repeatedly explain their background, projects, preferences, and context. Products like Claude memory or ChatGPT memory offer shallow, conversation-derived profiles. No open-source solution actively observes a user's real behavior — what they read, build, and spend time on — to construct a comprehensive, continuously updated understanding.

### 1.3 Target User

Developers, knowledge workers, and power users who:
- Interact with AI assistants daily and are frustrated by repeated context-setting
- Care about data sovereignty and want their personal data local
- Are comfortable with CLI tools and browser extension sideloading
- Have an API key for at least one LLM provider (OpenAI, Anthropic, etc.)

### 1.4 Success Criteria (v1)

| Metric | Target |
|--------|--------|
| Onboarding to first USER.md generated | < 5 minutes |
| Dreaming run (100 events) | < 3 minutes, < $0.05 API cost |
| Chat response with persona injection | Noticeably more contextual than vanilla LLM |
| Data never leaves machine | 100% (except LLM API calls with user's own key) |
| User can delete all data with one command | Yes |

---

## 2. User Stories

### 2.1 Onboarding

**US-01:** As a new user, I want to install the system with one command (`npm install -g persona-engine`) and be guided through setup, so I can start building my persona immediately.

**US-02:** As a new user, I want to answer a few questions about myself (name, occupation, interests) and point the system at my working directories, so the system has a starting point.

**US-03:** As a new user, I want to see my initial USER.md before the system starts, so I can review and correct any wrong assumptions.

**US-04:** As a new user, I want clear instructions for installing the browser extension, so I don't get stuck on technical steps.

### 2.2 Daily Collection

**US-05:** As a user, I want the browser extension to silently capture my browsing activity (URL, title, content excerpt, dwell time) without slowing down my browser.

**US-06:** As a user, I want to see a real-time event feed in my terminal showing what the system is capturing (URLs, dwell times, context switches), so I trust what it's doing.

**US-07:** As a user, I want to control which domains are tracked via an allowlist/blocklist, so sensitive sites are excluded.

**US-08:** As a user, I want to pause and resume collection at any time with a single command.

### 2.3 Dreaming

**US-09:** As a user, I want the system to automatically process my daily activity overnight, classifying events and updating my persona while I sleep.

**US-10:** As a user, I want to manually trigger dreaming at any time (`persona dream`), so I can see updates without waiting until night.

**US-11:** As a user, I want to see a clear report after each dreaming run showing what was classified, what patterns were found, and what changed in my persona.

**US-12:** As a user, I want old, irrelevant memories to gradually fade away, so my persona stays current and doesn't bloat.

### 2.4 Chat

**US-13:** As a user, I want to chat with an AI that already knows my background, current projects, and interests without me explaining anything.

**US-14:** As a user, I want to ask the system about my own behavior patterns ("What have I been focused on this week?", "What are my deep work hours?").

**US-15:** As a user, I want chat conversations to also feed into my persona over time.

### 2.5 Data Control

**US-16:** As a user, I want to view, edit, or delete my USER.md, any memory file, or any raw event at any time.

**US-17:** As a user, I want to completely wipe all data with one command (`persona reset`), so I can start fresh or uninstall cleanly.

---

## 3. Functional Requirements

### 3.1 Onboarding Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Interactive CLI questionnaire: name, preferred name, pronouns (optional), timezone (auto-detect with override), occupation, interests | P0 |
| FR-02 | Directory selector: user specifies one or more directories to scan | P0 |
| FR-03 | Directory scanner reads tree structure + key files (README.md, package.json, .gitignore, doc directory headings) | P0 |
| FR-04 | LLM receives questionnaire answers + directory analysis together to generate initial USER.md | P0 |
| FR-05 | USER.md presented to user in terminal for review; user can edit before confirming | P0 |
| FR-06 | Browser extension installation guide displayed after USER.md confirmation | P0 |
| FR-07 | Daemon auto-starts after onboarding completes | P0 |
| FR-08 | Onboarding state persisted — re-running onboard detects existing setup and offers reset or update | P1 |

### 3.2 Browser Extension

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | Chrome extension (Manifest V3), sideload distribution for v1 | P0 |
| FR-11 | Content extraction via Readability.js (Mozilla algorithm) — clean article text, not raw DOM | P0 |
| FR-12 | Captures: URL, document.title, content excerpt (first 500-1000 chars of Readability output), dwell time, tab switch events | P0 |
| FR-13 | Dwell time tracked via `visibilitychange` events + focus timer in background service worker | P0 |
| FR-14 | Events batched in service worker (every 30 seconds or on tab close) and sent via POST to daemon HTTP API | P0 |
| FR-15 | Domain allowlist/blocklist stored in extension local storage, configurable via extension popup | P0 |
| FR-16 | Extension popup shows: connection status to daemon, event count today, pause/resume toggle | P1 |
| FR-17 | Graceful offline handling: if daemon unreachable, queue events in IndexedDB up to 1000 entries, flush when daemon returns | P1 |

### 3.3 Daemon & HTTP API

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-20 | Node.js/TypeScript daemon process, runs in terminal with real-time TUI | P0 |
| FR-21 | HTTP server on `127.0.0.1:{configurable_port}` (default: 19000) | P0 |
| FR-22 | `POST /api/events` — accept single browser event, validate schema, write to events.sqlite | P0 |
| FR-23 | `POST /api/events/batch` — accept array of events | P0 |
| FR-24 | `GET /api/status` — daemon health, uptime, event count, last dreaming timestamp | P0 |
| FR-25 | `GET /api/user` — return current USER.md content | P1 |
| FR-26 | CORS restricted to Chrome extension origin only | P0 |
| FR-27 | Rate limiting: max 100 events/minute per source (prevent runaway extension bugs) | P1 |

### 3.4 Event Storage (events.sqlite)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-30 | SQLite database at `~/.persona-engine/events.sqlite` | P0 |
| FR-31 | Events table schema — see §4.1 | P0 |
| FR-32 | Status field: `pending` (unprocessed), `classified` (dreaming done), `archived` | P0 |
| FR-33 | Indexes on: timestamp, status, event_type | P0 |
| FR-34 | Chat messages also stored as events (event_type: `chat_message`) | P0 |
| FR-35 | Retention policy: raw events older than 90 days auto-archived (configurable) | P1 |

### 3.5 Dreaming Agent

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-40 | Scheduled trigger: cron-based, default `0 23 * * *` (11 PM local), user-configurable | P0 |
| FR-41 | Manual trigger: `persona dream` CLI command, processes all pending events | P0 |
| FR-42 | Manual trigger with time filter: `persona dream --since 2h` | P1 |
| FR-43 | Content-based classification: LLM reads event excerpts (not URLs) to assign tags | P0 |
| FR-44 | Controlled tag vocabulary: dreaming prompt includes full list of existing tags; LLM must reuse existing tags or explicitly justify new ones | P0 |
| FR-45 | Pattern inference: detect multi-day trends, learning streaks, focus shifts, behavioral changes | P0 |
| FR-46 | USER.md update: add/remove/modify identity tags, behavioral patterns, current context | P0 |
| FR-47 | USER.md compression: keep within token budget (~2000-4000 tokens), summarize/remove low-weight items | P0 |
| FR-48 | memory/ update: create/update category-organized markdown files with YAML frontmatter | P0 |
| FR-49 | memory/ category management: create new subdirectories when new categories emerge | P0 |
| FR-50 | Temporal decay: reduce `decay_weight` in memory files based on configurable half-life (default 30 days) | P0 |
| FR-51 | Dreaming report: log to terminal + write to `memory/meta/dreaming-log.md` | P0 |
| FR-52 | Cost tracking: estimate and display API cost per dreaming run | P1 |
| FR-53 | Dreaming lock: prevent concurrent dreaming runs | P0 |

### 3.6 Persona Layer (USER.md + memory/)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-60 | USER.md at `~/.persona-engine/USER.md` | P0 |
| FR-61 | USER.md schema: fixed template with sections — see product boundary §Data Layer | P0 |
| FR-62 | USER.md token budget enforced by dreaming agent | P0 |
| FR-63 | memory/ directory at `~/.persona-engine/memory/` | P0 |
| FR-64 | memory/ files: markdown with YAML frontmatter containing `tags`, `last_updated`, `decay_weight` | P0 |
| FR-65 | Vector embeddings for memory/ files stored in a local vector index (SQLite-backed) | P0 |
| FR-66 | Vector index auto-updates after each dreaming run | P0 |
| FR-67 | Semantic search API: given a query, return top-k relevant memory chunks | P0 |

### 3.7 Chat Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-70 | Terminal chat mode: `persona chat` opens interactive chat in terminal | P0 |
| FR-71 | Local web UI: minimal web interface served by daemon on `/chat` | P0 |
| FR-72 | System prompt injection: USER.md always included as system prompt prefix | P0 |
| FR-73 | Memory-augmented retrieval: for detailed queries, vector-search memory/ and inject top-k chunks into prompt | P0 |
| FR-74 | Remote LLM API: user configures provider + API key (supports OpenAI, Anthropic, Google, etc.) | P0 |
| FR-75 | Streaming responses: token-by-token streaming in both terminal and web UI | P0 |
| FR-76 | Chat history persisted to events.sqlite as chat_message events (feeds into dreaming) | P0 |
| FR-77 | Conversation context: maintain session history within a chat session | P0 |

### 3.8 CLI

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-80 | `persona onboard` — run onboarding flow | P0 |
| FR-81 | `persona start` — start daemon | P0 |
| FR-82 | `persona stop` — stop daemon | P0 |
| FR-83 | `persona status` — show daemon state, event counts, next dreaming schedule | P0 |
| FR-84 | `persona dream [--since <duration>]` — trigger dreaming | P0 |
| FR-85 | `persona chat` — open terminal chat | P0 |
| FR-86 | `persona user` — view USER.md; `persona user --edit` to open in $EDITOR | P0 |
| FR-87 | `persona memory [category]` — browse memory/ tree or specific category | P1 |
| FR-88 | `persona events [--since <duration>] [--status <status>]` — query events | P1 |
| FR-89 | `persona config` — view/edit configuration | P1 |
| FR-90 | `persona reset` — wipe all data (with confirmation prompt) | P0 |
| FR-91 | `persona pause` / `persona resume` — pause/resume event collection | P1 |

### 3.9 Terminal TUI (Daemon Display)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-95 | Real-time event feed: show incoming events with URL (domain+path), dwell time, deep read indicator | P0 |
| FR-96 | Today's summary: event count, deep reads count, context switches, total browse time, chat messages | P0 |
| FR-97 | Dreaming status: last run timestamp + result summary, next scheduled run, pending event count | P0 |
| FR-98 | Keyboard shortcuts: [c] open chat, [d] trigger dream, [s] show status, [q] quit | P0 |
| FR-99 | Dreaming progress: real-time log during dreaming (classifying..., patterns found..., updating...) | P0 |

---

## 4. Data Models

### 4.1 events.sqlite Schema

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,          -- 'page_visit', 'tab_switch', 'chat_message', 'context_switch'
    url TEXT,                          -- full URL (null for non-browser events)
    title TEXT,                        -- page title or chat message preview
    excerpt TEXT,                      -- Readability.js extracted content (up to 1000 chars)
    dwell_time_sec INTEGER,            -- seconds spent (null for non-dwell events)
    source TEXT NOT NULL DEFAULT 'browser',  -- 'browser', 'chat', 'directory_scan'
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'classified', 'archived'
    tags TEXT,                         -- JSON array of assigned tags (null until classified)
    metadata TEXT,                     -- JSON blob for event-type-specific data
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    classified_at TEXT,                -- timestamp of dreaming classification
    dreaming_run_id TEXT              -- which dreaming run classified this event
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_type ON events(event_type);
```

### 4.2 memory/ File Format

```yaml
---
tags: [coding, rust, async-programming]
last_updated: 2026-04-11T23:02:00Z
decay_weight: 0.95
created: 2026-04-08T23:01:00Z
source_events: [1042, 1043, 1055, 1089]   # event IDs that contributed
---

# Rust Async Programming

## Key Learnings
- User has been studying Tokio runtime internals for 4 days (Apr 8-11)
- Focus areas: task scheduling, runtime configuration, spawn vs spawn_blocking
- Read 12 articles and documentation pages on this topic
- Spent approximately 4.5 hours total on Rust async content

## Notable Sources
- docs.rs/tokio — primary reference (multiple visits)
- Rust async book — foundational reading
- Multiple Stack Overflow questions on lifetime issues in async contexts

## Inferred Context
- This appears to be a new skill acquisition, not maintenance of existing knowledge
- User's existing skills include React and Python (see USER.md)
- Possible motivation: building a new project in Rust (correlates with persona-engine project)
```

### 4.3 Configuration File

Location: `~/.persona-engine/config.json`

```json
{
  "daemon": {
    "port": 19000,
    "host": "127.0.0.1"
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-..."
  },
  "dreaming": {
    "schedule": "0 23 * * *",
    "decayHalfLifeDays": 30,
    "userMdTokenBudget": 3000
  },
  "collection": {
    "browser": {
      "enabled": true,
      "blocklist": ["bank.example.com", "mail.google.com"],
      "allowlist": [],
      "excerptMaxChars": 1000
    },
    "directories": [
      "/Users/me/projects",
      "/Users/me/Documents/notes"
    ]
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small"
  },
  "events": {
    "retentionDays": 90
  }
}
```

---

## 5. Technical Architecture

### 5.1 Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Daemon | Node.js / TypeScript | Aligns with OpenClaw ecosystem, good async I/O, npm distribution |
| Database | SQLite (better-sqlite3) | Zero config, single file, good enough for single-user local app |
| Vector search | SQLite + sqlite-vec extension | No separate vector DB needed, keeps everything in one file |
| Terminal TUI | Ink (React for CLI) or Blessed | Rich terminal UI with real-time updates |
| HTTP server | Fastify | Lightweight, fast, good TypeScript support |
| Browser extension | TypeScript + Readability.js | Manifest V3, content script + service worker |
| Web UI | Minimal HTML/JS served by daemon | No framework needed for v1 chat UI |
| LLM client | Vercel AI SDK or direct HTTP | Multi-provider support (OpenAI, Anthropic, Google, etc.) |
| Embedding | OpenAI text-embedding-3-small (default) | Cheapest good-quality embeddings, configurable |

### 5.2 Directory Structure

```
persona-engine/
├── packages/
│   ├── daemon/              # Main daemon process
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point
│   │   │   ├── server.ts          # HTTP API (Fastify)
│   │   │   ├── tui.ts             # Terminal UI
│   │   │   ├── db/
│   │   │   │   ├── events.ts      # events.sqlite operations
│   │   │   │   └── vectors.ts     # vector index operations
│   │   │   ├── dreaming/
│   │   │   │   ├── scheduler.ts   # Cron scheduling
│   │   │   │   ├── classifier.ts  # Content-based classification
│   │   │   │   ├── inferrer.ts    # Pattern inference
│   │   │   │   ├── updater.ts     # USER.md + memory/ writer
│   │   │   │   └── decay.ts       # Temporal decay logic
│   │   │   ├── onboarding/
│   │   │   │   ├── questionnaire.ts
│   │   │   │   ├── scanner.ts     # Directory scanner
│   │   │   │   └── generator.ts   # Initial USER.md generation
│   │   │   ├── chat/
│   │   │   │   ├── session.ts     # Chat session management
│   │   │   │   ├── retrieval.ts   # Memory-augmented retrieval
│   │   │   │   └── llm.ts        # LLM API client
│   │   │   └── config.ts         # Configuration management
│   │   └── package.json
│   │
│   ├── cli/                 # CLI commands
│   │   ├── src/
│   │   │   ├── index.ts          # Command router
│   │   │   ├── commands/
│   │   │   │   ├── onboard.ts
│   │   │   │   ├── start.ts
│   │   │   │   ├── stop.ts
│   │   │   │   ├── status.ts
│   │   │   │   ├── dream.ts
│   │   │   │   ├── chat.ts
│   │   │   │   ├── user.ts
│   │   │   │   ├── memory.ts
│   │   │   │   ├── events.ts
│   │   │   │   ├── config.ts
│   │   │   │   └── reset.ts
│   │   │   └── utils/
│   │   └── package.json
│   │
│   ├── extension/           # Chrome browser extension
│   │   ├── manifest.json          # Manifest V3
│   │   ├── background.ts         # Service worker
│   │   ├── content.ts            # Content script (Readability)
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.ts
│   │   └── lib/
│   │       └── readability.js    # Mozilla Readability
│   │
│   └── web-ui/             # Minimal chat web UI
│       ├── index.html
│       ├── chat.js
│       └── style.css
│
├── templates/
│   └── USER.md             # Default USER.md template
│
├── package.json             # Monorepo root
├── tsconfig.json
└── README.md
```

### 5.3 Data Directory Layout (User's Machine)

```
~/.persona-engine/
├── config.json              # User configuration
├── USER.md                  # Abstract persona
├── events.sqlite            # Raw events + vector index
├── memory/                  # Detailed memories
│   ├── coding/
│   ├── research/
│   ├── projects/
│   ├── interests/
│   └── meta/
│       ├── dreaming-log.md
│       └── pattern-changelog.md
└── logs/                    # Daemon logs
```

---

## 6. API Specifications

### 6.1 Daemon HTTP API

**Base URL:** `http://127.0.0.1:19000/api`

#### POST /api/events

Submit a single browser event.

```
Request:
{
  "event_type": "page_visit",
  "url": "https://docs.rs/tokio/latest/tokio/runtime",
  "title": "tokio::runtime - Rust",
  "excerpt": "A runtime for writing reliable...",
  "dwell_time_sec": 180,
  "timestamp": "2026-04-11T14:32:00Z"
}

Response: 201
{ "id": 1042, "status": "pending" }
```

#### POST /api/events/batch

Submit multiple events.

```
Request:
{ "events": [ ...array of event objects... ] }

Response: 201
{ "inserted": 5, "ids": [1042, 1043, 1044, 1045, 1046] }
```

#### GET /api/status

```
Response: 200
{
  "daemon": "running",
  "uptime_sec": 28800,
  "port": 19000,
  "events_today": 47,
  "events_pending": 203,
  "last_dreaming": {
    "timestamp": "2026-04-10T23:00:00Z",
    "events_processed": 156,
    "duration_sec": 133,
    "cost_usd": 0.03
  },
  "next_dreaming": "2026-04-11T23:00:00Z",
  "user_md_tokens": 2847
}
```

#### GET /api/user

```
Response: 200
{ "content": "# USER.md — About You\n..." }
```

#### POST /api/chat

Send a chat message and receive a streaming response.

```
Request:
{ "message": "What have I been focused on this week?" }

Response: 200 (SSE stream)
data: {"type": "token", "content": "Based"}
data: {"type": "token", "content": " on"}
...
data: {"type": "done", "usage": {"prompt_tokens": 3200, "completion_tokens": 450}}
```

### 6.2 Extension ↔ Daemon Protocol

Extension authenticates via a shared token generated during onboarding and stored in both extension storage and daemon config. This prevents other local apps from injecting events.

```
Headers:
  Content-Type: application/json
  Authorization: Bearer <shared_token>
```

---

## 7. Dreaming Agent Prompts

### 7.1 Classification Prompt

```
You are a classification agent for a personal behavioral modeling system.

## Existing Tags
{existing_tags_json}

## Rules
1. Classify each event based on its CONTENT (excerpt), not its URL.
2. Reuse existing tags whenever possible.
3. If no existing tag fits, propose a new tag and explain why.
4. Each event can have 1-3 tags.
5. Return valid JSON only.

## Events to Classify
{events_json}

## Output Format
{
  "classifications": [
    {
      "event_id": 1042,
      "tags": ["coding/rust", "learning"],
      "confidence": 0.92,
      "reasoning": "Article about Tokio runtime internals"
    }
  ],
  "new_tags": [
    {
      "tag": "devops/docker",
      "justification": "Multiple events about Docker containerization, not covered by existing tags"
    }
  ]
}
```

### 7.2 Pattern Inference Prompt

```
You are a behavioral pattern analyst for a personal modeling system.

## Current USER.md
{user_md_content}

## Events from the last {period} (classified)
{classified_events_with_tags}

## Tasks
1. Identify new behavioral patterns or changes in existing ones.
2. Detect learning streaks, focus shifts, or new interests.
3. Note any changes in work rhythm (deep work hours, context switching frequency).
4. Suggest updates to USER.md sections: Identity Tags, Behavioral Patterns, Current Context.
5. Identify which memory/ files should be created or updated.

## Output Format
{
  "patterns": [
    {
      "type": "learning_streak",
      "description": "Rust async programming study — day 4",
      "confidence": 0.88,
      "evidence": [1042, 1043, 1055, 1089]
    }
  ],
  "user_md_updates": {
    "identity_tags": { "add": {"Learning": ["Rust"]}, "remove": {} },
    "behavioral_patterns": [],
    "current_context": { "recent_focus": "Rust async programming, persona-engine architecture" }
  },
  "memory_updates": [
    {
      "path": "coding/rust-learning.md",
      "action": "update",
      "content_summary": "Add 4 new entries about Tokio runtime"
    }
  ]
}
```

### 7.3 Compression Prompt

Runs when USER.md exceeds token budget.

```
You are a persona compression agent. The USER.md below exceeds the token budget of {budget} tokens (current: {current} tokens).

## Current USER.md
{user_md_content}

## Current decay weights from memory/
{decay_weights_summary}

## Rules
1. Remove or shorten items with low decay weight (stale, not recently reinforced).
2. Merge similar items (e.g., multiple related skills into one line).
3. Keep the most recent and frequently reinforced items.
4. Preserve the template structure (all sections must remain).
5. Current Context section should always reflect the last 1-2 weeks.
6. Output the compressed USER.md in full.
```

---

## 8. Development Milestones

### Phase 1: Foundation (Week 1-2)

**Goal:** Daemon starts, accepts events, stores them.

| Task | Est. |
|------|------|
| Project scaffolding (monorepo, TypeScript, build pipeline) | 2d |
| Configuration management (`config.json` read/write/defaults) | 1d |
| events.sqlite setup (schema, CRUD operations) | 1d |
| HTTP server (Fastify, `/api/events`, `/api/status`) | 1d |
| Basic terminal TUI (event feed, today's summary) | 2d |
| CLI skeleton (`persona start`, `stop`, `status`) | 1d |

**Deliverable:** `persona start` launches daemon, extension (or curl) can POST events, TUI shows them.

### Phase 2: Onboarding + Directory Scan (Week 3)

**Goal:** New user goes from zero to initial USER.md.

| Task | Est. |
|------|------|
| Interactive questionnaire (Inquirer.js or similar) | 1d |
| Directory scanner (tree structure + key file reader) | 1.5d |
| LLM integration (multi-provider client, initial USER.md generation) | 1.5d |
| USER.md review/edit flow in terminal | 0.5d |
| `persona onboard` command end-to-end | 0.5d |

**Deliverable:** `persona onboard` produces a USER.md from user input + directory analysis.

### Phase 3: Browser Extension (Week 4-5)

**Goal:** Extension captures browsing activity and sends to daemon.

| Task | Est. |
|------|------|
| Manifest V3 extension scaffold | 0.5d |
| Content script with Readability.js integration | 2d |
| Background service worker (dwell time, tab tracking, batching) | 2d |
| Event POST to daemon HTTP API with auth token | 1d |
| Extension popup (status, pause/resume, domain blocklist) | 1.5d |
| Offline queue (IndexedDB fallback) | 1d |
| Extension install guide in onboarding flow | 0.5d |

**Deliverable:** Extension silently captures browsing, daemon receives and stores events.

### Phase 4: Dreaming Engine (Week 6-8)

**Goal:** Nightly processing classifies events and builds persona.

| Task | Est. |
|------|------|
| Cron scheduler (node-cron) | 0.5d |
| Classification agent (prompt engineering, controlled tag vocabulary) | 3d |
| Pattern inference agent | 2d |
| USER.md updater (parse, modify, write back) | 2d |
| memory/ file manager (create dirs, write files with YAML frontmatter) | 2d |
| Temporal decay implementation | 1d |
| USER.md compression agent | 1d |
| Dreaming report + logging | 1d |
| `persona dream` command with `--since` flag | 0.5d |
| Dreaming TUI progress display | 1d |

**Deliverable:** `persona dream` processes pending events, updates USER.md and memory/.

### Phase 5: Chat + Retrieval (Week 9-10)

**Goal:** User can chat with persona-aware AI.

| Task | Est. |
|------|------|
| Vector embedding pipeline for memory/ files | 2d |
| Semantic search (query → top-k memory chunks) | 1.5d |
| System prompt builder (USER.md + retrieved memory chunks) | 1d |
| Terminal chat interface (streaming responses) | 2d |
| Minimal web chat UI (HTML/JS, served by daemon) | 2d |
| Chat history → events.sqlite integration | 0.5d |
| `/api/chat` SSE endpoint | 1d |

**Deliverable:** `persona chat` and `localhost:19000/chat` both work with full persona context.

### Phase 6: Polish + Release (Week 11-12)

**Goal:** v1 ready for public release.

| Task | Est. |
|------|------|
| CLI completeness (all commands, help text, error handling) | 2d |
| Configuration validation and sensible defaults | 1d |
| `persona reset` (full data wipe) | 0.5d |
| Error handling + recovery (daemon crash recovery, corrupt DB handling) | 2d |
| README + documentation | 2d |
| npm package publishing pipeline | 1d |
| Extension packaging for sideload | 0.5d |
| End-to-end testing (onboard → collect → dream → chat) | 2d |

**Deliverable:** `npm install -g persona-engine` works end-to-end.

---

## 9. Non-Functional Requirements

### 9.1 Performance

| Metric | Target |
|--------|--------|
| Event ingestion latency (HTTP API) | < 50ms |
| Daemon memory usage (idle) | < 100MB |
| Daemon memory usage (during dreaming) | < 300MB |
| Extension memory overhead | < 30MB |
| Extension page load impact | < 100ms added |
| Vector search latency (top-5 from 10k chunks) | < 200ms |

### 9.2 Security

- Daemon only binds to `127.0.0.1` — not accessible from network
- Extension ↔ daemon auth via shared token
- API keys stored in `config.json` with file permissions `600`
- No telemetry, no analytics, no phone-home
- Content excerpts processed locally — raw page content never sent externally
- LLM API calls contain classified events and persona data — user must understand this when providing their API key

### 9.3 Reliability

- Daemon auto-recovers from crash (PID file + restart logic)
- events.sqlite uses WAL mode for crash resilience
- Dreaming is idempotent — interrupted run can be safely re-triggered
- Extension queues events offline if daemon is down

---

## 10. Out of Scope (v1)

These items are explicitly excluded from v1 to keep scope manageable:

- Web UI dashboard (beyond minimal chat page)
- Multi-device sync
- Persona export/import
- Plugin system for additional input sources
- Firefox / Safari / Edge extensions
- MCP server for external agent integration
- Collaborative / team personas
- Mobile apps
- Self-hosted LLM / local model support
- OS-level activity monitoring (active app tracking beyond browser)

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| LLM classification inconsistency (tag drift) | Medium | High | Controlled tag vocabulary with full existing tag list in every prompt |
| API cost exceeding user expectations | High | Medium | Cost estimation before dreaming, configurable token budgets, clear documentation |
| Readability.js fails on complex SPAs | Medium | High | Fallback to `document.title` + first 500 chars of `innerText` |
| Manifest V3 service worker lifecycle issues | Medium | Medium | Event batching + IndexedDB queue for offline resilience |
| USER.md growing beyond token budget | Low | Medium | Compression agent runs as final dreaming step |
| Extension sideloading discourages non-technical users | Medium | High | v1 targets power users; Chrome Web Store in future |
| Concurrent dreaming runs corrupt data | High | Low | File-based lock + idempotent design |

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| **Persona** | The structured model of the user (USER.md + memory/) |
| **Dreaming** | Nightly (or manual) batch process where LLM classifies events and updates persona |
| **USER.md** | Abstract, high-level persona file (always in system prompt, token-budgeted) |
| **memory/** | Directory of detailed, category-organized memory files (vector-searchable) |
| **Controlled tag vocabulary** | Mechanism ensuring LLM reuses existing tags rather than creating synonymous new ones |
| **Temporal decay** | Mechanism reducing weight of stale memories over time (configurable half-life) |
| **Excerpt** | Clean text extracted from web pages by Readability.js (500-1000 chars) |
| **Deep read** | A page visit with dwell time exceeding threshold (default: 5 minutes) |
| **Event** | Any captured user activity: page visit, tab switch, chat message |