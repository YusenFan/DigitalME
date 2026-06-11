# Development Notes

## 2026-04-11 — Phase 1: Foundation

### What was built

Phase 1 搭建了 Persona Engine 的基础骨架：monorepo 脚手架、配置管理、SQLite 事件存储、HTTP API、终端 TUI、CLI 命令。

### Tech decisions made

| Decision | Choice | Reason |
|----------|--------|--------|
| Package manager | pnpm + workspace | 原生 monorepo 支持，磁盘高效 |
| Node target | 22+ (ES2023) | 用户当前环境 Node 25 |
| Onboarding UI | @clack/prompts | 专为 CLI wizard 设计（Phase 2 用） |
| Daemon TUI | Ink (React for CLI) | 组件化开发，实时更新 |
| Build tool | tsup (esbuild-based) | 快速，零配置 |
| CLI framework | Commander.js | 轻量，成熟 |

### Files created

```
packages/daemon/src/
  ├── index.tsx       — Daemon 入口：启动 server + TUI + PID file + graceful shutdown
  ├── config.ts       — ~/.persona-engine/config.json 读写，深度合并默认值
  ├── server.ts       — Fastify HTTP API (POST /api/events, POST /api/events/batch, GET /api/status)
  ├── db/events.ts    — SQLite (WAL mode) events 表 CRUD + getTodayStats
  └── tui/
      ├── App.tsx       — TUI 根组件，布局 + 快捷键（支持非 TTY 环境）
      ├── EventFeed.tsx — 实时事件流，含 deep read / idle 判定
      └── Summary.tsx   — 今日统计面板

packages/cli/src/
  ├── index.ts              — Commander 命令路由
  └── commands/
      ├── start.ts          — persona start（前台/后台模式）
      ├── stop.ts           — persona stop（SIGTERM via PID file）
      └── status.ts         — persona status（调用 /api/status）
```

### Issues encountered & resolved

1. **better-sqlite3 native addon** — pnpm 10 默认不运行 install scripts，需要在 `pnpm-workspace.yaml` 设置 `onlyBuiltDependencies`。且 `node-gyp` 不在全局 PATH，需要用 `npx node-gyp` 手动编译。
2. **Ink raw mode error** — 后台运行时 stdin 不是 TTY，`useInput` 会崩溃。修复：加 `isActive: isInteractive` 检测 `process.stdin.isTTY`。
3. **@types/better-sqlite3** — 最新版本是 7.6.13 不是 7.6.14，pnpm 严格版本匹配报错。

### Design note: deep read vs idle

用户提出了一个重要问题：单纯挂机不应算深度阅读。当前方案：
- TUI 层：dwell > 5min 且 < 45min → "deep"，> 45min → "idle?"（保守估计）
- 真正的智能判定在 Phase 3（扩展端 visibilitychange 追踪活跃时间）和 Phase 4（dreaming 内容分类）

### Verification results

- `pnpm build` 编译成功
- `persona start --background` 后台启动 daemon
- `curl POST /api/events` 返回 201 + event id
- `curl POST /api/events/batch` 批量插入成功
- `curl GET /api/status` 返回完整统计
- TUI 实时刷新事件流和统计面板
- `persona status` 显示 daemon 运行状态
- `persona stop` 正常关闭 daemon

## 2026-04-13 — Phase 2: Onboarding + Directory Scan

### What was built

Phase 2 实现了完整的 onboarding 流程：交互式问卷、目录扫描、LLM 生成 USER.md、用户审核/编辑/带反馈重新生成。运行 `persona onboard` 即可从零开始构建用户 persona。

### Tech decisions made

| Decision | Choice | Reason |
|----------|--------|--------|
| LLM provider | OpenAI (gpt-5.4) | 用户指定使用 OpenAI API |
| LLM SDK | Vercel AI SDK (`ai` + `@ai-sdk/openai`) | 多 provider 支持，PRD 推荐
| Onboarding UI | @clack/prompts | Phase 1 已决定 |
| 问卷字段 | name, birthday, pronouns, timezone, occupation, interests, social profiles | 用户要求合并 name/preferred name 为单一字段，增加 birthday，增加社交媒体链接 |
| 文档扫描 | 文件名作为标题信号（不解析内容） | PDF/Word/Excel/Apple iWork 文件只取文件名，避免复杂解析依赖 |

### Files created

```
packages/daemon/src/onboarding/
  ├── questionnaire.ts  — 交互式问卷（@clack/prompts），收集用户信息和目录
  ├── scanner.ts        — 目录扫描器：树结构 + 关键文件 + 文档检测（PDF/Word/Excel/Pages/Numbers/Keynote）
  ├── llm.ts            — LLM 客户端工厂（Vercel AI SDK + OpenAI provider）
  └── generator.ts      — USER.md 生成器，支持带用户反馈的重新生成

packages/cli/src/commands/
  └── onboard.ts        — `persona onboard` 完整流程命令

templates/
  └── USER.md           — 默认 persona 模板（含 birthday 字段）
```

### Files modified

- `packages/daemon/src/config.ts` — 新增 `USER_MD_PATH`、`isOnboarded()`，默认 LLM 改为 OpenAI/gpt-5.4；数据目录从 `~/.persona-engine/` 改为 `<project>/persona-engine/`
- `packages/cli/src/index.ts` — 注册 onboard 命令
- `packages/cli/src/commands/start.ts` — 从 config.ts 导入 PID_FILE，不再硬编码 `~/.persona-engine/` 路径
- `packages/cli/src/commands/stop.ts` — 同上
- `packages/cli/src/commands/status.ts` — 同上，使用 loadConfig() 读取端口号
- `packages/daemon/package.json` — 新增依赖：ai, @ai-sdk/openai, @ai-sdk/anthropic, @clack/prompts
- `packages/cli/package.json` — 新增依赖：@clack/prompts, ai, @ai-sdk/openai
- `.gitignore` — `.persona-engine/` 改为 `persona-engine/`

### Design decisions

1. **Onboarding 不依赖 daemon 运行** — onboarding 是独立的 CLI 流程，直接 import daemon 的 onboarding 模块源码（通过相对路径），tsup 打包时内联。
2. **重新生成带反馈** — 用户选择 regenerate 时可以输入修改意见（如"多加 Python 经验描述"），LLM 会基于上一版 USER.md + 反馈进行修改。
3. **目录扫描兼容非技术文件夹** — 不仅扫描代码项目，也检测普通文档文件（PDF, Word, Excel, Apple iWork），用文件名作为内容信号。
4. **已有 persona 检测** — 重复运行 `persona onboard` 会提示 reset/update/cancel。
5. **社交媒体收集** — 问卷中收集 LinkedIn、X (Twitter)、Instagram 及其他社交/作品集链接（均为可选），传给 LLM 以生成更丰富的用户画像。
6. **必填字段防空输入** — 必填问题（name、occupation、API key）使用 `requiredText()` / `requiredPassword()` 循环，空输入时重新提示而非终止流程。
7. **系统原生目录选择器** — macOS 上使用 `osascript choose folder` 弹出 Finder 文件夹选择对话框，用户可视化选择目录，无需手动输入路径。非 macOS 回退为手动输入。
8. **数据目录改为项目内非隐藏目录** — 从 `~/.persona-engine/`（用户主目录隐藏文件夹）改为 `<project>/persona-engine/`（项目目录内可见文件夹）。通过 `import.meta.dirname` 从构建产物位置反推项目根目录，CLI 和 daemon 两端路径一致。所有 CLI 命令统一从 config.ts 导入路径常量，不再各自硬编码。

### Verification results

- `pnpm build` 编译成功
- `persona onboard --help` 正常显示帮助信息
- CLI 命令列表包含 onboard（排在 start/stop/status 之前）
- 数据目录路径正确解析：CLI 和 daemon 均指向 `<project>/persona-engine/`

## 2026-04-15 — Phase 3: Browser Extension

### What was built

Phase 3 实现了 Chrome 浏览器扩展（Manifest V3），用于采集用户浏览行为并发送给 daemon HTTP API。包含内容提取、停留时间追踪、事件批量发送、离线队列、以及 popup 管理界面。

### Tech decisions made

| Decision | Choice | Reason |
|----------|--------|--------|
| Extension format | Manifest V3 | Chrome 最新标准，service worker 架构 |
| Content extraction | @mozilla/readability | PRD 指定，Mozilla 算法提取干净文章文本 |
| Build tool | tsup (ESM output) | 与 monorepo 其他包一致，输出自包含 JS 文件 |
| Dwell time tracking | chrome.tabs.onActivated + chrome.windows.onFocusChanged | 标签页切换 + 窗口焦点变化双重追踪 |
| Event batching | chrome.alarms (30s interval) | Manifest V3 service worker 可能随时终止，alarms 比 setInterval 可靠 |
| Offline queue | IndexedDB | Service worker 中可用，上限 1000 条 |
| Extension settings | chrome.storage.local | 持久化 blocklist、daemon URL、pause 状态 |

### Files created

```
packages/extension/
  ├── manifest.json       — Manifest V3 配置：权限（tabs, storage, alarms）、host_permissions、content_scripts
  ├── popup.html          — Popup UI：连接状态、事件计数、暂停/恢复、域名黑名单、daemon URL
  ├── popup.css           — Popup 样式（紫色主题，320px 宽度）
  ├── package.json        — 依赖：@mozilla/readability, @types/chrome, tsup
  ├── tsconfig.json       — TypeScript 配置（DOM lib, bundler moduleResolution）
  ├── tsup.config.ts      — 三入口打包（background, content, popup），ESM 格式，所有依赖内联
  ├── icons/              — 占位图标（icon16/48/128.png）
  ├── scripts/
  │   ├── copy-static.js    — 静态文件说明
  │   └── generate-icons.js — 占位图标生成器
  └── src/
      ├── types.ts          — 共享类型：BrowserEvent, ContentMessage, ExtensionSettings 等
      ├── content.ts        — Content Script：Readability.js 提取页面内容 → 发送给 background
      ├── background.ts     — Service Worker：dwell time 追踪、tab/window 事件、批量发送、离线队列
      ├── popup.ts          — Popup 逻辑：状态刷新、暂停/恢复、设置保存
      └── lib/
          └── queue.ts      — IndexedDB 离线队列（enqueue, peekAll, clearAll, getQueueSize）
```

### Design decisions

1. **Content Script 职责单一** — 只负责提取页面内容（Readability.js），不做网络请求。通过 `chrome.runtime.sendMessage` 传给 background。
2. **Dwell time 计算在 background** — content script 发送页面内容时开始计时，标签页切换或关闭时结算。最少 2 秒才算有效（排除快速划过）。
3. **Domain filtering** — blocklist 优先于 allowlist。hostname 精确匹配 + 子域名匹配（`hostname.endsWith("." + domain)`）。
4. **chrome.alarms 替代 setInterval** — Manifest V3 service worker 可被浏览器随时终止，chrome.alarms 在 worker 重启后仍能触发。
5. **离线队列自动 flush** — 每次批量发送成功后，自动尝试 flush IndexedDB 中的离线事件。service worker 初始化时也尝试一次。
6. **Popup 实时状态** — 打开 popup 时从 background 获取最新状态（连接、事件数、队列大小），不缓存。
7. **最小内容阈值** — 提取内容 < 50 字符的页面不采集（空白页、登录页等无意义内容）。
8. **CORS 已就绪** — daemon server.ts 在 Phase 1 已配置 `chrome-extension://` origin 的 CORS 白名单，无需修改。

### Verification results

- `pnpm build` 全部 3 个包编译成功
- TypeScript `tsc --noEmit` 零错误
- 输出文件路径与 manifest.json 引用一致（dist/background.js, dist/content.js, dist/popup.js）
- 所有输出文件自包含（无 import/export 语句），兼容 Chrome content script 加载方式
- manifest.json 权限完整（tabs, activeTab, storage, alarms）
- host_permissions 匹配 daemon 默认地址（http://127.0.0.1:19000/*）

### How to sideload the extension

1. Chrome 地址栏输入 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/extension/` 目录
5. 确保 daemon 已运行（`persona start`）

---

## 2026-04-15 — Phase 4: Dreaming Engine

### What was built

Phase 4 实现了 Persona Engine 的核心智能层 — Dreaming Engine，负责对浏览事件进行 LLM 分类、行为模式推断、persona 更新和记忆管理。

### New files

| File | Purpose |
|------|---------|
| `packages/daemon/src/dreaming/classifier.ts` | 内容分类器 — LLM 按内容分类事件，受控标签词汇表，分批处理（20/batch），index 映射（不依赖 LLM 返回 event_id） |
| `packages/daemon/src/dreaming/inferrer.ts` | 行为模式推断器 — 检测学习连续性、焦点转移、工作节奏，输出 USER.md 和 memory/ 更新建议 |
| `packages/daemon/src/dreaming/updater.ts` | USER.md + memory/ 更新器 — LLM 重写 USER.md，创建/合并 memory 文件（YAML frontmatter） |
| `packages/daemon/src/dreaming/decay.ts` | 时间衰减 — 指数衰减 memory 文件的 decay_weight，半衰期可配（默认 30 天） |
| `packages/daemon/src/dreaming/compressor.ts` | USER.md 压缩器 — 超出 token 预算时 LLM 压缩，优先删除 stale 内容 |
| `packages/daemon/src/dreaming/index.ts` | Dreaming 编排器 — 完整 pipeline：classify → infer → update → decay → compress → report。含运行锁、唯一 runId |
| `packages/daemon/src/dreaming/scheduler.ts` | Cron 调度器 — node-cron 定时触发 dreaming（默认每晚 23:00） |
| `packages/cli/src/commands/dream.ts` | `persona dream` CLI 命令 — 手动触发 dreaming，支持 `--since` 时间过滤 |

### Modified files

| File | Changes |
|------|---------|
| `packages/daemon/src/db/events.ts` | 新增 `getAllTags()`, `getPendingEventsSince()`, `markEventsClassified()`, `getClassifiedEventsSince()` |
| `packages/daemon/src/index.tsx` | 集成 dreaming 调度器启动/停止，添加 dreaming 进度状态传递给 TUI |
| `packages/daemon/src/tui/App.tsx` | 新增 dreaming 状态面板，[d] 键手动触发 dreaming |
| `packages/cli/src/index.ts` | 注册 `dream` 子命令 |
| `packages/daemon/tsup.config.ts` | external 新增 `node-cron` |
| `packages/cli/tsup.config.ts` | external 新增 `better-sqlite3`, `node-cron` |

### Tech decisions made

1. **分类 ID 映射由代码处理** — LLM 只返回按数组索引的分类结果，event_id 映射在代码中完成，避免 LLM 返回错误 ID
2. **受控标签词汇表** — 每次分类都传入全部已有标签，LLM 必须优先复用，防止 tag 碎片化（如 "frontend" vs "前端"）
3. **动态标签更新** — 分批处理时，前一批新增的标签自动加入后一批的词汇表
4. **运行锁** — 文件锁防止并发 dreaming，30 分钟超时自动释放僵尸锁
5. **USER.md 整体重写** — 不用正则 patch（自然语言段落不适合），交给 LLM 保持模板结构
6. **memory/ YAML frontmatter** — 每个文件含 tags、last_updated、decay_weight、created、source_events
7. **指数衰减** — `weight = weight × 0.5^(days/halfLife)`，低于 0.1 标记为 stale
8. **CLI dream 独立于 daemon** — 直接初始化数据库运行 pipeline，不需要 daemon 在运行

### Dreaming pipeline 流程

```
1. 获取 pending 事件
2. 分类（classifier）→ 按内容分类，受控标签
3. 标记事件 classified，写入 tags + run_id
4. 推断行为模式（inferrer）→ 最近 7 天 classified 事件
5. 更新 USER.md（updater）→ LLM 重写
6. 更新 memory/ 文件（updater）→ 创建/合并
7. 时间衰减（decay）→ 所有 memory 文件
8. 压缩 USER.md（compressor）→ 仅超预算时
9. 写入 dreaming-log.md 报告
```

### New dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `node-cron` | ^3.x | Cron 定时调度 dreaming |
| `@types/node-cron` | ^3.x | TypeScript 类型 |

### Build verification

- `pnpm --filter @persona-engine/daemon build` ✅
- `pnpm --filter @persona-engine/cli build` ✅
- `persona --help` 显示 dream 命令 ✅
- `persona dream --help` 显示 --since 选项 ✅

---

## 2026-04-15 — Phase 5: Chat + Retrieval

### What was built

Phase 5 实现了 persona-aware 聊天系统：向量化 memory/ 文件用于语义搜索，构建注入 USER.md + 相关记忆的系统提示，支持终端和 Web 两种聊天界面，流式输出。

### New files

| File | Purpose |
|------|---------|
| `packages/daemon/src/db/vectors.ts` | 向量存储 + 语义搜索 — embedding 生成（Vercel AI SDK）、SQLite 存储、余弦相似度 top-k 搜索、memory/ 同步 |
| `packages/daemon/src/chat/retrieval.ts` | Memory-augmented 检索 — 为用户查询生成 embedding，语义搜索 memory/，返回 USER.md + 相关记忆片段 |
| `packages/daemon/src/chat/session.ts` | 聊天会话管理 — 构建系统提示（USER.md + memory 上下文）、流式 LLM 调用、聊天消息存入 events.sqlite |
| `packages/cli/src/commands/chat.ts` | `persona chat` CLI 命令 — 交互式终端聊天，readline 界面，流式输出 |
| `packages/web-ui/index.html` | Web 聊天 UI — HTML 页面 |
| `packages/web-ui/style.css` | Web 聊天 UI — 暗色主题样式 |
| `packages/web-ui/chat.js` | Web 聊天 UI — SSE 流式接收、会话历史管理 |

### Modified files

| File | Changes |
|------|---------|
| `packages/daemon/src/server.ts` | 新增 `GET /api/user`, `POST /api/chat`（SSE 流式）, `GET /chat`（Web UI 静态文件） |
| `packages/daemon/src/index.tsx` | 初始化向量表 `initVectorTable()` |
| `packages/daemon/src/tui/App.tsx` | 底部提示改为 `[c] chat at http://127.0.0.1:19000/chat` |
| `packages/cli/src/index.ts` | 注册 `chat` 子命令 |
| `packages/cli/tsup.config.ts` | external 新增 `@ai-sdk/openai`, `ai` |

### Tech decisions made

1. **纯 JS 余弦相似度** — 不依赖 sqlite-vec 扩展，避免 native 扩展安装问题。向量以 JSON 数组存储在 TEXT 字段，JavaScript 端计算相似度。对 memory/ 文件数量（通常 < 100）足够高效。
2. **整文件作为一个 chunk** — memory/ 文件通常不大（< 8KB），直接对整个文件生成单个 embedding，不做分块。截取前 8000 字符防止 token 超限。
3. **Embedding 容错** — embedding API 不可用时聊天仍可工作，只是没有 memory 增强（只有 USER.md）。
4. **SSE 流式响应** — POST /api/chat 返回 Server-Sent Events 格式，每个 token 一个 `data:` 事件。Web UI 用 `ReadableStream` 消费。
5. **聊天消息双向存储** — 用户消息和助手回复都存入 events.sqlite（event_type: "chat_message"），metadata 区分 role。后续 dreaming 可以从聊天内容推断兴趣。
6. **Web UI 由 daemon 直接 serve** — 静态文件在 `packages/web-ui/`，daemon server 通过文件路径提供。无需额外构建步骤。
7. **CLI chat 独立于 daemon** — 与 dream 命令一样，直接初始化数据库和向量表运行，不需要 daemon。
8. **会话历史截断** — 保留最近 20 条消息（10 轮对话），防止 context window 溢出。

### API endpoints added

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user` | GET | 返回 USER.md 内容 |
| `/api/chat` | POST | 流式聊天（SSE），接受 `{message, history?}` |
| `/chat` | GET | Web 聊天 UI 页面 |
| `/chat/style.css` | GET | Web UI 样式 |
| `/chat/chat.js` | GET | Web UI 脚本 |

### Chat system architecture

```
用户输入消息
    │
    ├── 1. generateEmbedding(message)    → 查询向量
    ├── 2. semanticSearch(queryVec, k=5) → 相关 memory 片段
    ├── 3. readUserMd()                  → USER.md 全文
    │
    ▼
buildSystemPrompt(userMd, memoryChunks)
    │
    ▼
streamText(model, system, messages)
    │
    ├── onToken → 流式输出到终端/Web
    ├── onDone  → 存入 events.sqlite
    └── onError → 错误处理
```

### Build verification

- `pnpm --filter @persona-engine/daemon build` ✅
- `pnpm --filter @persona-engine/cli build` ✅
- `persona --help` 显示 chat 命令 ✅

---

## 2026-04-15 — Phase 6: Polish + Release

### What was built

Phase 6 完成了 v1 发布前的全部打磨工作：补齐所有 CLI 命令（共 13 条）、配置验证、错误恢复、测试基础设施、README 文档、扩展打包脚本。

### New files

| File | Purpose |
|------|---------|
| `packages/cli/src/commands/user.ts` | `persona user` — 查看/编辑 USER.md（支持 `--edit` 打开 $EDITOR） |
| `packages/cli/src/commands/reset.ts` | `persona reset` — 完全清除所有 persona 数据（需确认，`--force` 跳过） |
| `packages/cli/src/commands/memory.ts` | `persona memory [category]` — 浏览 memory/ 目录树，显示文件权重和更新时间 |
| `packages/cli/src/commands/events.ts` | `persona events` — 查询 events.sqlite（支持 `--since`, `--status`, `--type`, `--limit`） |
| `packages/cli/src/commands/config.ts` | `persona config` — 查看配置（API key 遮蔽）或修改（`--set key=value` dot notation） |
| `packages/cli/src/commands/pause.ts` | `persona pause` / `persona resume` — 暂停/恢复浏览器事件采集 |
| `tests/config.test.ts` | 配置验证测试（4 个测试用例） |
| `tests/events-db.test.ts` | SQLite 事件存储测试（6 个测试用例） |
| `tests/server-api.test.ts` | HTTP API 集成测试（5 个测试用例） |
| `tests/cli.test.ts` | CLI 命令集成测试（8 个测试用例） |
| `vitest.config.ts` | Vitest 测试配置 |
| `README.md` | 完整项目 README（架构、安装、使用、配置、隐私） |
| `packages/extension/scripts/package.js` | 扩展打包脚本 → 生成 `persona-extension-v0.1.0.zip` |

### Modified files

| File | Changes |
|------|---------|
| `packages/cli/src/index.ts` | 注册 7 个新子命令（user, memory, events, config, reset, pause, resume），总计 13 条 |
| `packages/daemon/src/config.ts` | 新增 `validateConfig()` 配置验证、`cleanStalePidFile()` 残留 PID 清理 |
| `packages/daemon/src/index.tsx` | 启动流程增加：残留 PID 清理、配置验证、数据库初始化错误处理、全局异常处理器 |
| `packages/daemon/src/server.ts` | 事件端点增加采集暂停检查（`collection.browser.enabled`） |
| `packages/extension/package.json` | 新增 `package` 脚本 |
| `packages/cli/package.json` | 新增 `files`, `keywords` 字段用于 npm 发布 |
| `package.json` | 新增 `test`, `test:watch` 脚本，新增 vitest + better-sqlite3 + fastify devDependencies |
| `.gitignore` | 新增 `*.zip` |

### CLI commands — complete list (13 commands)

| Command | Description | Phase |
|---------|-------------|-------|
| `persona onboard` | 交互式问卷 + 目录扫描 + USER.md 生成 | Phase 2 |
| `persona start` | 启动 daemon（前台/后台模式） | Phase 1 |
| `persona stop` | 停止 daemon | Phase 1 |
| `persona status` | 显示 daemon 状态和今日统计 | Phase 1 |
| `persona dream [--since]` | 手动触发 dreaming | Phase 4 |
| `persona chat` | 终端交互式聊天 | Phase 5 |
| `persona user [--edit]` | 查看/编辑 USER.md | **Phase 6** |
| `persona memory [category]` | 浏览 memory/ 目录 | **Phase 6** |
| `persona events [--since] [--status] [--type]` | 查询事件 | **Phase 6** |
| `persona config [--set] [--path]` | 查看/修改配置 | **Phase 6** |
| `persona reset [--force]` | 清除所有数据 | **Phase 6** |
| `persona pause` | 暂停浏览器采集 | **Phase 6** |
| `persona resume` | 恢复浏览器采集 | **Phase 6** |

### Error handling improvements

1. **配置验证** — daemon 启动前验证所有关键配置字段（port 范围、provider 存在、token budget 下限）
2. **残留 PID 清理** — daemon 启动时自动检测并清理上次崩溃残留的 PID 文件
3. **数据库初始化容错** — SQLite 打开失败时给出清晰的错误信息和修复建议
4. **全局异常处理** — uncaughtException 和 unhandledRejection 处理器确保 PID 文件和数据库连接在崩溃时被清理
5. **采集暂停检查** — HTTP API 端点在采集暂停时返回 503，防止数据写入

### Test infrastructure

- **框架:** Vitest v4.1.4
- **测试数量:** 23 个测试，4 个测试文件
- **覆盖范围:** 配置验证、SQLite 操作、HTTP API、CLI 命令
- **运行方式:** `pnpm test`（单次）或 `pnpm test:watch`（监听模式）
- **隔离:** DB 测试使用临时文件（`os.tmpdir()`），测试后自动清理

### Build verification

- `pnpm build` 全部 3 个包编译成功 ✅
- `pnpm test` 23 个测试全部通过 ✅
- `persona --help` 显示全部 13 条命令 ✅
- `persona config` 正确显示配置（API key 遮蔽） ✅
- `persona memory` 显示 memory/ 树 ✅
- `persona events --help` 显示所有选项 ✅
- 扩展打包 `persona-extension-v0.1.0.zip`（26 KB）✅

---

## 2026-06-10 — Phase 6.5: mem0 Memory Management

### What was built

Phase 6.5 将原先自研的 markdown memory 文件 + SQLite vector 表检索，替换为 mem0 open-source SDK 管理长期记忆。Dreaming pipeline 仍然负责分类、推断和 USER.md 更新，但详细记忆的写入、抽取、去重、持久化和语义检索改由 mem0 处理。

### New files

| File | Purpose |
|------|---------|
| `packages/daemon/src/memory/mem0.ts` | mem0 封装层 — 配置本地 SQLite vector/history store，提供 `addMemoryUpdates()`, `searchMemories()`, `listMemories()` |

### Modified files

| File | Changes |
|------|---------|
| `packages/daemon/src/dreaming/updater.ts` | `updateMemoryFiles()` 改为调用 mem0，而不是创建/合并 markdown memory 文件 |
| `packages/daemon/src/dreaming/index.ts` | 将完整 `PersonaConfig` 传入 memory updater，供 mem0 使用 LLM/embedding 配置 |
| `packages/daemon/src/chat/retrieval.ts` | 检索路径改为 `searchMemories()`，不再手动生成 embedding 或查询 `memory_vectors` |
| `packages/daemon/src/dreaming/decay.ts` | 旧 markdown decay 改为兼容 no-op，保留报告字段稳定性 |
| `packages/daemon/src/index.tsx` | 移除 daemon 启动时的 `initVectorTable()` |
| `packages/cli/src/commands/chat.ts` | chat 逻辑改为 action 内动态导入，避免 CLI help 提前加载 mem0 深依赖 |
| `packages/cli/src/commands/dream.ts` | dream 逻辑改为 action 内动态导入，避免普通 CLI 命令加载 mem0 |
| `packages/cli/src/commands/memory.ts` | `persona memory` 改为列出/查看 mem0 长期记忆 |
| `packages/daemon/tsup.config.ts` | external 新增 `mem0ai`, `mem0ai/oss` |
| `packages/cli/tsup.config.ts` | external 新增 `mem0ai`, `mem0ai/oss` |
| `packages/daemon/package.json` | 新增依赖 `mem0ai` |
| `packages/cli/package.json` | 新增依赖 `mem0ai`（CLI 直接运行 dream/chat/memory，需要运行时可解析） |
| `README.md` | 架构和使用说明从 `memory/` 文件系统改为 mem0 SQLite memory |
| `pnpm-lock.yaml` | 锁定 `mem0ai@3.0.6` |

### Removed files

| File | Reason |
|------|--------|
| `packages/daemon/src/db/vectors.ts` | 旧的自研 embedding + SQLite vector 检索模块已被 mem0 取代 |

### Tech decisions made

1. **mem0 OSS SDK 作为 memory 管理边界** — Persona Engine 不再自己合并 memory 文件、维护 vector 表或计算相似度。代码只把 inferrer 输出交给 mem0，并从 mem0 检索相关记忆。
2. **Local-first storage** — mem0 vector store 使用本地 SQLite，数据文件放在 `DATA_DIR` 下：`mem0-vectors.db` 和 `mem0-history.db`。
3. **复用现有 LLM/embedding 配置** — mem0 的 LLM provider/model/API key 和 embedding provider/model 从 `PersonaConfig` 读取，不新增独立配置。
4. **关闭 mem0 telemetry** — 在动态加载 SDK 前设置 `MEM0_TELEMETRY=false`，保持项目 no telemetry 的隐私承诺。
5. **动态导入 CLI 重依赖** — `persona --help`, `persona config`, `persona events --help` 等轻量命令不应加载 mem0 及其深依赖。`chat`, `dream`, `memory` 在真正执行时才加载对应模块。
6. **保留 decay 报告兼容性** — `DreamingReport.decayResults` 暂时保留，避免改动报告结构；实际 memory ranking/管理交给 mem0。
7. **保留 USER.md 职责** — USER.md 仍是抽象 persona；mem0 只接管详细长期记忆。

### Memory flow after Phase 6.5

```
Dreaming inferrer
    │
    ├── updateUserMd()      → USER.md 抽象 persona
    └── updateMemoryFiles()
            │
            ▼
        mem0.add()
            │
            ├── extract / dedupe / update durable memories
            ├── persist vectors in mem0-vectors.db
            └── persist history in mem0-history.db

Chat retrieval
    │
    ├── readUserMd()
    └── mem0.search(query, topK=5)
            │
            ▼
buildSystemPrompt(USER.md + relevant mem0 memories)
```

### Verification results

- `pnpm --filter @persona-engine/daemon build` ✅
- `pnpm --filter @persona-engine/cli build` ✅
- `pnpm test` — 23 tests passed ✅
- `node packages/cli/dist/index.js memory` smoke test ✅

### Notes

- `pnpm add mem0ai` produced peer warnings for some optional mem0 ecosystem packages (`better-sqlite3`, `pg`, `redis`), but builds, tests, and the CLI smoke test passed.
- The old `memory/` directory is no longer the primary memory store. It remains useful for existing metadata such as `memory/meta/dreaming-log.md`.

---

## 2026-06-10 — Phase 7: Mastra Agent MVP

### What was built

Phase 7 引入了最小 Mastra agent infra：daemon 内部使用 Mastra Agent + MCP-style typed tools 访问本地 persona 数据，并新增非流式 JSON 测试 API。没有暴露标准 MCP server；所有工具都是只读本地工具。

### New files

| File | Purpose |
|------|---------|
| `packages/daemon/src/agent/tools.ts` | Mastra `createTool` 工具定义：读取 USER.md、搜索 mem0 memories、查询最近 events、读取今日 status |
| `packages/daemon/src/agent/persona-agent.ts` | 创建 DigitalME Mastra Agent，注入 USER.md、OpenAI model id、read-only tools |
| `packages/daemon/src/agent/session.ts` | 统一 agent generate/stream wrapper，负责聊天消息写入 events.sqlite |
| `tests/agent-api.test.ts` | `/api/agent/test` 路由测试，使用 fake runner，避免真实 LLM 调用 |
| `tests/agent-tools.test.ts` | agent tools 单元测试，覆盖 profile、memory search fallback、recent events、status |

### Modified files

| File | Changes |
|------|---------|
| `packages/daemon/src/server.ts` | `/api/chat` 改用 `streamAgentReply()`；新增 `POST /api/agent/test` JSON 测试端点 |
| `packages/daemon/src/chat/session.ts` | 改为兼容 shim，转发到新的 agent session |
| `packages/cli/src/commands/chat.ts` | CLI chat 改用 `streamAgentReply()` |
| `packages/daemon/src/db/events.ts` | 新增 `getRecentEventsForAgent()`，支持 agent tool 的只读过滤查询 |
| `packages/daemon/package.json` | 新增 `@mastra/core`, `zod`；升级 `ai` 满足 Mastra peer dependency |
| `packages/cli/package.json` | 新增 CLI 运行时所需 `@mastra/core`, `zod`；升级 `ai` |
| `packages/daemon/tsup.config.ts` / `packages/cli/tsup.config.ts` | 将 Mastra 和 zod 标记为 external runtime deps |

### API endpoints added/changed

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | 保持原 SSE contract，但内部改由 Mastra agent streaming 驱动 |
| `/api/agent/test` | POST | 非流式测试 API，接受 `{ message, history?, includeDebug? }`，返回 `{ reply, toolCalls?, toolResults? }` |

### Agent tools

| Tool | Purpose |
|------|---------|
| `persona_get_profile` | 读取当前 USER.md |
| `persona_search_memories` | 通过现有 mem0 `searchMemories()` 搜索长期记忆 |
| `persona_get_recent_events` | 查询最近本地 events，支持 `limit/status/type` |
| `persona_get_status` | 返回今日本地状态摘要 |

### Tech decisions made

1. **保留 mem0 memory management** — dreaming 仍通过 mem0 写入长期记忆；agent 只通过 tool 调用 `searchMemories()` 读取。
2. **不暴露 MCP server** — MVP 只采用 MCP-style typed tool 设计，避免新增外部协议面。
3. **只读工具优先** — 所有 agent tools 都带 read-only MCP annotations，不修改本地数据。
4. **Fastify 继续作为 API 边界** — Mastra 嵌入 daemon 内部，现有 HTTP/TUI/CLI 架构不重做。
5. **测试不调用真实 LLM** — `/api/agent/test` 使用 injected fake runner 测试路由行为。

### Verification results

- `pnpm build` 全部 workspace build 成功 ✅
- `pnpm test` 30 个测试全部通过 ✅

---

## 2026-06-10 — Phase 8: macOS Menu Bar Shell (Flutter)

### What was done

把 Persona Engine 包装成 macOS 状态栏 App 的第一步（对应 `macos-migration-plan.md` 的 Phase 1–4 代码部分）。Flutter 只做壳：spawn/停止 node daemon、轮询健康状态、tray 菜单。daemon 业务逻辑零重写。

### New files

| File | Purpose |
|------|---------|
| `macos-migration-plan.md` | 完整迁移方案（架构、阶段、macOS 权限、技术决策） |
| `apps/macos_shell/pubspec.yaml` | Flutter 项目定义；仅两个插件：tray_manager（NSStatusItem）、window_manager（隐藏窗口/关窗不退出） |
| `apps/macos_shell/lib/main.dart` | tray 菜单（Open Chat / Start-Stop / Status / Run Dreaming Now / Settings / Quit）+ 默认隐藏的状态窗口 |
| `apps/macos_shell/lib/daemon_controller.dart` | 进程管理（spawn node --headless / SIGTERM / 防孤儿）+ /api/status 轮询 + 路径解析（dev 模式从可执行文件路径反推 repo 根） |
| `apps/macos_shell/assets/tray_icon.png` | 模板图标（黑+透明，isTemplate 自动适配深浅色） |
| `scripts/setup_macos_shell.sh` | 一键生成 macos/ Runner + 打补丁：LSUIElement=true、删 App Sandbox entitlement |

### Modified files

| File | Changes |
|------|---------|
| `packages/daemon/src/server.ts` | 新增 `POST /api/dreaming/run`（409 防重入）；`/api/status` 加 `dreaming_running` 字段；`CreateServerOptions` 加 `dreaming?: DreamingControl` 注入接口 |
| `packages/daemon/src/index.tsx` | dreaming 状态块上移到 createServer 之前（端点需要引用锁）；`triggerDream` 改为同步上锁 + finally 释放；新增 `--headless` 参数跳过 Ink TUI（供 GUI spawn 使用） |

### Tech decisions made

1. **Flutter spawn 而非 launch agent** — 一个进程拥有者，Quit 即全停；launch agent 留给 v2 真常驻需求。
2. **聊天复用 daemon 的 /chat Web UI** — 浏览器打开，不在 Flutter 里重写聊天界面。
3. **external 实例不接管** — 端口上已有 CLI 启动的 daemon 时菜单只显示状态，Stop 禁用。
4. **App Sandbox 必须关闭** — daemon 要扫任意目录 + spawn node，沙箱下全失败；放弃 App Store 分发。
5. **数据目录不变** — 仍是 `~/.persona-engine/`，CLI / TUI / App 共享同一份数据。

### Verification results

- `tsc --noEmit`：server.ts / index.tsx 无类型错误 ✅（其余报错为本 phase 之前已存在，tsup 构建不受影响）
- Dart 代码需在 Mac 上 `flutter analyze` 验证（本环境无 Flutter SDK）⏳
- 待用户在 Mac 上执行：`pnpm build` → `bash scripts/setup_macos_shell.sh` → `flutter run -d macos`

### How to run

```bash
pnpm build                              # 构建 daemon
bash scripts/setup_macos_shell.sh       # 生成 Runner + 补丁（只需一次）
cd apps/macos_shell && flutter run -d macos
```

### Fix (2026-06-11): 启动即静默退出、无 tray 图标

原因：Flutter macOS 模板的 `AppDelegate.applicationShouldTerminateAfterLastWindowClosed` 默认返回 `true`，窗口在启动时被隐藏后 App 直接退出（无崩溃报告、无 Dart 异常）。

修复（均为 window_manager 文档要求的集成步骤）：
- `AppDelegate.swift`：`applicationShouldTerminateAfterLastWindowClosed` 改为 `false`
- `MainFlutterWindow.swift`：加 `hiddenWindowAtLaunch()`（官方 "Hidden at launch" 集成），启动隐藏改由原生侧处理
- `lib/main.dart`：移除 Dart 侧启动时的 `windowManager.hide()`
- `scripts/setup_macos_shell.sh`：以上两个 Swift 补丁加入脚本（幂等），全新 checkout 可重现
