# Persona Engine

> A local-first system that actively builds a living behavioral model of you.

Persona Engine observes your file directories, browser activity, and chat conversations to construct a continuously updated understanding of who you are. All data stays on your machine. An LLM processes raw activity in nightly "dreaming" sessions to classify events, infer patterns, and maintain a structured persona. The persona then feeds into a chat interface, giving any AI assistant deep context about you.

## How It Works

```
  Input Sources                    Processing                   Output
  ─────────────                    ──────────                   ──────
  Onboarding questionnaire    ──┐
  Directory scan              ──┤                            USER.md
  Browser extension           ──┼── events.sqlite ── Dream ── (abstract persona)
  Chat conversations          ──┘       │                    memory/
                                        │                    (detailed, searchable)
                                        │
                                   Chat Interface
                                   (USER.md + memory/ in system prompt)
```

**Daytime:** Browser extension silently collects browsing events (URL, title, content excerpt, dwell time). Zero LLM cost.

**Dreaming:** Nightly (or manual) batch processing classifies events, detects behavioral patterns, updates your persona, and manages memory decay. Typically < $0.05 per run.

**Chat:** Ask questions with full persona context injected. Terminal or web UI.

## Quick Start

### Prerequisites

- Node.js >= 22
- pnpm
- An API key for OpenAI or Anthropic

### Install

```bash
git clone <repo-url> persona-engine
cd persona-engine
pnpm install
pnpm build
```

### Setup

```bash
# Run the onboarding wizard
persona onboard

# Start the daemon
persona start

# Install the Chrome extension (optional)
# 1. Open chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" → select packages/extension/
```

### Usage

```bash
# Daemon control
persona start              # Start daemon (foreground)
persona start --background # Start daemon (background)
persona stop               # Stop daemon
persona status             # Show daemon status and today's stats

# Dreaming
persona dream              # Manually trigger dreaming (process all pending events)
persona dream --since 2h   # Process only last 2 hours of events

# Chat
persona chat               # Interactive terminal chat
# Or open http://127.0.0.1:19000/chat in your browser

# Persona management
persona user               # View your USER.md
persona user --edit         # Edit USER.md in $EDITOR
persona memory             # Browse memory/ directory tree
persona memory coding      # Inspect a specific memory category

# Data queries
persona events             # Show recent events
persona events --since 1d  # Events from last 24 hours
persona events --status classified  # Only classified events

# Configuration
persona config             # Show current config (API key masked)
persona config --set llm.model=gpt-4o  # Update a config value
persona config --path      # Show config file location

# Collection control
persona pause              # Pause browser event collection
persona resume             # Resume collection

# Data management
persona reset              # Wipe all data (with confirmation)
persona reset --force      # Wipe without confirmation
```

## Architecture

```
persona-engine/
├── packages/
│   ├── daemon/          # Core daemon: HTTP API, SQLite, TUI, dreaming engine
│   ├── cli/             # CLI commands (persona ...)
│   ├── extension/       # Chrome browser extension (Manifest V3)
│   └── web-ui/          # Minimal chat web UI
├── persona-engine/      # User data directory (gitignored)
│   ├── config.json      # Configuration
│   ├── USER.md          # Abstract persona
│   ├── events.sqlite    # Raw events + vector embeddings
│   └── memory/          # Detailed memories by category
└── tests/               # Integration tests
```

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js / TypeScript |
| Database | SQLite (better-sqlite3, WAL mode) |
| HTTP server | Fastify |
| Terminal TUI | Ink (React for CLI) |
| Browser extension | Manifest V3, Readability.js |
| LLM client | Vercel AI SDK (OpenAI, Anthropic) |
| Embeddings | OpenAI text-embedding-3-small |
| Build | tsup (esbuild), pnpm workspaces |

## Data Flow

### 1. Collection (zero LLM cost)

The browser extension extracts clean article text via Readability.js, tracks dwell time and tab switches, and batches events to the daemon HTTP API every 30 seconds. Events are stored in `events.sqlite` with status `pending`.

### 2. Dreaming (LLM batch processing)

Triggered nightly at 23:00 (configurable) or manually via `persona dream`:

1. **Classify** — Content-based categorization with controlled tag vocabulary
2. **Infer** — Detect behavioral patterns, learning streaks, focus shifts
3. **Update USER.md** — Refine abstract persona within token budget
4. **Update memory/** — Create/merge detailed memory files with YAML frontmatter
5. **Decay** — Exponential weight decay on stale memories (30-day half-life)
6. **Compress** — Keep USER.md within token budget

### 3. Chat (persona-aware)

System prompt = USER.md + semantically relevant memory/ chunks. Vector embeddings enable semantic search over memories. Supports streaming responses in both terminal and web UI.

## Configuration

Config file: `persona-engine/config.json` (created during onboarding)

Key settings:

```json
{
  "daemon": { "port": 19000 },
  "llm": { "provider": "openai", "model": "gpt-5.4", "apiKey": "..." },
  "dreaming": {
    "schedule": "0 23 * * *",
    "decayHalfLifeDays": 30,
    "userMdTokenBudget": 3000
  },
  "embedding": { "provider": "openai", "model": "text-embedding-3-small" }
}
```

## Privacy

- All data stored locally — nothing leaves your machine except LLM API calls
- Daemon binds to `127.0.0.1` only — not network-accessible
- Content extracted locally in browser via Readability.js
- API keys stored with file permissions `600`
- No telemetry, no analytics

## Development

```bash
pnpm install
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm dev          # Watch mode (all packages)
```

## License

MIT
