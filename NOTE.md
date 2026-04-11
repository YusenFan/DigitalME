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
