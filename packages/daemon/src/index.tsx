/**
 * index.tsx — Daemon 入口文件
 *
 * 负责按顺序启动所有子系统：
 *   1. 加载配置
 *   2. 初始化 SQLite 数据库
 *   3. 启动 Fastify HTTP 服务器
 *   4. 渲染 Ink TUI
 *   5. 写入 PID 文件（让 CLI 知道 daemon 在运行）
 *   6. 监听退出信号，graceful shutdown
 *
 * 这个文件同时是 CLI `persona start` 启动的目标进程。
 *
 * 参数：
 *   --headless — 不渲染 Ink TUI（供 macOS App 等非终端环境 spawn 使用）
 */

import fs from "node:fs";
import React from "react";
import { render } from "ink";
import { loadConfig, PID_FILE, ensureDataDir, validateConfig, cleanStalePidFile } from "./config.js";
import { initDatabase, closeDatabase, getRecentEvents, getTodayStats } from "./db/events.js";
import { createServer, startServer } from "./server.js";
import { App } from "./tui/App.js";
import { startScheduler, stopScheduler } from "./dreaming/scheduler.js";
import { runDreaming, type DreamingProgress } from "./dreaming/index.js";

/** TUI 刷新间隔（毫秒）— 每秒刷新一次统计数据 */
const TUI_REFRESH_INTERVAL_MS = 1000;

/**
 * 主启动流程。
 * 任何步骤失败都会打印错误并退出进程。
 */
async function main() {
  // ── 0. 清理残留 PID 文件 ────────────────────
  if (cleanStalePidFile()) {
    console.log("Cleaned up stale PID file from previous crash.");
  }

  // ── 1. 加载配置 + 验证 ─────────────────────
  const config = loadConfig();
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    console.error("Configuration errors:");
    for (const err of configErrors) {
      console.error(`  - ${err}`);
    }
    console.error('\nFix these in persona-engine/config.json or run "persona config --set key=value".');
    process.exit(1);
  }

  // ── 2. 初始化数据库 ────────────────────────
  try {
    initDatabase();
  } catch (err) {
    console.error("Failed to initialize database:", (err as Error).message);
    console.error("The database may be corrupted. Try running \"persona reset\" to start fresh.");
    process.exit(1);
  }

  // ── 3. Dreaming 状态 + 触发函数 ──────────────
  // 在 createServer 之前定义，因为 HTTP 端点 /api/dreaming/run 需要引用它们
  let rerender: (() => void) | null = null;

  /** 当前的 dreaming 进度消息（TUI 显示用） */
  let dreamingLog: string[] = [];
  let isDreaming = false;

  /** Dreaming 进度回调 — 更新 TUI */
  function onDreamingProgress(progress: DreamingProgress) {
    isDreaming = progress.stage !== "done" && progress.stage !== "error";
    dreamingLog.push(progress.message);
    // 只保留最近 10 条
    if (dreamingLog.length > 10) {
      dreamingLog = dreamingLog.slice(-10);
    }
    rerender?.();
  }

  /** 手动触发 dreaming（TUI [d] 键 / POST /api/dreaming/run） */
  async function triggerDream() {
    if (isDreaming) return; // 防止重复触发
    isDreaming = true; // 立即上锁，避免 HTTP 端点并发触发
    try {
      await runDreaming(undefined, onDreamingProgress);
    } catch {
      // error 已经通过 onDreamingProgress 报告
    } finally {
      isDreaming = false;
    }
  }

  // ── 4. 启动 HTTP 服务器 ─────────────────────
  // onEventInserted 回调：新事件写入后触发 TUI 重新渲染
  const app = await createServer(
    config,
    (_eventIds) => {
      // 新事件到达时触发重新渲染
      rerender?.();
    },
    {
      dreaming: {
        isRunning: () => isDreaming,
        run: () => {
          void triggerDream();
        },
      },
    }
  );

  const address = await startServer(app, config);

  // ── 5. 写入 PID 文件 + 启动调度器 ────────────
  // CLI 的 stop 命令通过读取此文件找到 daemon 进程并发送 SIGTERM
  ensureDataDir();
  fs.writeFileSync(PID_FILE, process.pid.toString(), "utf-8");

  startScheduler(config.dreaming.schedule, onDreamingProgress);

  // ── 6. 渲染 TUI（--headless 时跳过） ─────────
  /**
   * 获取 TUI 需要的数据并触发渲染。
   * 数据来自 SQLite 查询，每次调用都是最新的。
   */
  function renderTui() {
    const events = getRecentEvents(50);
    const stats = getTodayStats();
    return (
      <App
        events={events}
        stats={stats}
        serverAddress={address}
        dreamingLog={dreamingLog}
        isDreaming={isDreaming}
        onDream={triggerDream}
      />
    );
  }

  const headless = process.argv.includes("--headless");

  let inkInstance: ReturnType<typeof render> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  if (headless) {
    // headless 模式：不渲染 TUI，stdout 只输出一行启动日志。
    // 进程由 HTTP 服务器和 cron 调度器保持存活。
    console.log(`Persona Engine daemon running at ${address} (headless, PID ${process.pid})`);
  } else {
    // 首次渲染
    inkInstance = render(renderTui());

    // rerender 函数：查询最新数据后重新渲染
    rerender = () => {
      inkInstance!.rerender(renderTui());
    };

    // 定时刷新 — 即使没有新事件，统计面板的时间也需要更新
    refreshTimer = setInterval(() => {
      rerender?.();
    }, TUI_REFRESH_INTERVAL_MS);
  }

  // ── 7. Graceful shutdown ────────────────────
  /**
   * 清理函数：关闭所有子系统。
   * 无论是用户按 q、Ctrl+C 还是收到 SIGTERM，都走这个流程。
   */
  async function shutdown() {
    if (refreshTimer) clearInterval(refreshTimer);
    stopScheduler();
    inkInstance?.unmount();

    // 关闭 HTTP 服务器（等待进行中的请求完成）
    await app.close();

    // 关闭数据库连接
    closeDatabase();

    // 删除 PID 文件（标记 daemon 已停止）
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }

    process.exit(0);
  }

  // 监听退出信号
  process.on("SIGINT", shutdown); // Ctrl+C
  process.on("SIGTERM", shutdown); // kill / persona stop

  // Ink 退出时（用户按 q）也触发 shutdown
  // headless 模式没有 TUI，main 直接返回，进程靠服务器/调度器保活
  if (inkInstance) {
    await inkInstance.waitUntilExit();
    await shutdown();
  }
}

// ── 启动 ────────────────────────────────────────────────

// 全局未捕获异常处理 — 确保 PID 文件被清理
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    closeDatabase();
  } catch { /* best effort cleanup */ }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

main().catch((err) => {
  console.error("Daemon failed to start:", err);
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch { /* best effort */ }
  process.exit(1);
});
