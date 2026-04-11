/**
 * commands/start.ts — `persona start` 命令
 *
 * 启动 daemon 进程。两种模式：
 *   - 前台模式（默认）：直接运行 daemon，TUI 显示在当前终端
 *   - 后台模式（--background）：fork 子进程运行 daemon，当前终端不阻塞
 *
 * 启动前检查 PID 文件，如果 daemon 已经在运行则提示用户。
 */

import { Command } from "commander";
import { spawn, fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** PID 文件路径 — 与 daemon 侧的 config.ts 保持一致 */
const PID_FILE = path.join(os.homedir(), ".persona-engine", "daemon.pid");

/** daemon 入口文件路径（构建后的位置） */
const DAEMON_ENTRY = path.resolve(
  import.meta.dirname,
  "../../daemon/dist/index.js"
);

/**
 * 检查 daemon 是否已在运行。
 * 通过读取 PID 文件并检查进程是否存活来判断。
 */
function isDaemonRunning(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;

  const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (isNaN(pid)) return false;

  try {
    // signal 0 不会杀死进程，只检查进程是否存在
    process.kill(pid, 0);
    return true;
  } catch {
    // 进程不存在 — PID 文件是残留的，清理掉
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

export const startCommand = new Command("start")
  .description("Start the Persona Engine daemon")
  .option("-b, --background", "Run daemon in background (detached)")
  .action((options) => {
    // 检查是否已在运行
    if (isDaemonRunning()) {
      const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
      console.log(`Daemon is already running (PID: ${pid}).`);
      console.log('Use "persona stop" to stop it first.');
      process.exit(1);
    }

    if (options.background) {
      // ── 后台模式 ─────────────────────────────
      // 使用 fork 创建分离的子进程
      const child = fork(DAEMON_ENTRY, [], {
        detached: true, // 从父进程分离
        stdio: "ignore", // 不继承父进程的 stdin/stdout/stderr
      });

      // 让父进程可以立即退出，不等待子进程
      child.unref();

      console.log(`Daemon started in background (PID: ${child.pid}).`);
      console.log('Use "persona status" to check, "persona stop" to stop.');
    } else {
      // ── 前台模式 ─────────────────────────────
      // 用 spawn 运行 daemon，继承当前终端的 stdio
      // 这样 Ink TUI 能正常显示在用户终端中
      const child = spawn("node", [DAEMON_ENTRY], {
        stdio: "inherit", // 共享终端的 stdin/stdout/stderr
      });

      // 转发退出信号给子进程
      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));

      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });
    }
  });
