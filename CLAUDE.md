### what is this
Persona Engine is an local-first system that actively builds a living behavioral model of the user by ingesting their file directories, browser activity, and chat conversations. All data stays on the user's machine. An LLM processes raw activity in nightly "dreaming" sessions to classify, infer patterns, and maintain a structured persona in markdown. The persona then feeds into a chat interface, giving any AI assistant deep context about who the user is.

### Tech stack

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

### Programme style

如果不确定意图，停下来问。不要猜。
### 代码风格
可读性 > 聪明。如果一名初级开发者在30秒内看不懂，重写它。

不要提前抽象。在出现第三个重复之前保持内联。

在发明新模式之前，先匹配代码库中现有的模式。

#### 不要做的事
不要添加我没有要求的功能。

除非我说可以，否则不要重构工作代码。

未经询问不要安装新依赖。

不要因为“简单”而跳过测试。

不要写只是重申代码的注释。

