/**
 * commands/status.ts — `persona status` 命令
 *
 * 显示 daemon 的运行状态。
 * 先检查 PID 文件判断 daemon 是否运行，
 * 然后调用 GET /api/status 获取详细信息。
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PID_FILE = path.join(os.homedir(), ".persona-engine", "daemon.pid");
const CONFIG_PATH = path.join(os.homedir(), ".persona-engine", "config.json");

/** 默认端口，与 daemon config 保持一致 */
const DEFAULT_PORT = 19000;

/**
 * 从 config.json 读取 daemon 端口号。
 * 读取失败则返回默认值。
 */
function getDaemonPort(): number {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    return config?.daemon?.port ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * 格式化秒数为可读的 uptime 字符串。
 * 例：3661 → "1h 1m 1s"
 */
function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export const statusCommand = new Command("status")
  .description("Show Persona Engine daemon status")
  .action(async () => {
    // ── 1. 检查 PID 文件 ────────────────────
    if (!fs.existsSync(PID_FILE)) {
      console.log("Daemon is not running.");
      console.log('Start it with "persona start".');
      return;
    }

    const pid = fs.readFileSync(PID_FILE, "utf-8").trim();

    // 检查进程是否存活
    try {
      process.kill(parseInt(pid, 10), 0);
    } catch {
      console.log(`Daemon is not running (stale PID file: ${pid}).`);
      fs.unlinkSync(PID_FILE);
      return;
    }

    // ── 2. 调用 /api/status 获取详细信息 ────
    const port = getDaemonPort();
    const url = `http://127.0.0.1:${port}/api/status`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`Daemon is running (PID: ${pid}) but API returned ${response.status}.`);
        return;
      }

      const data = (await response.json()) as Record<string, unknown>;

      // ── 3. 格式化输出 ────────────────────
      console.log(`Persona Engine — daemon running (PID: ${pid})`);
      console.log("─".repeat(45));
      console.log(`  Port:             ${data.port}`);
      console.log(`  Uptime:           ${formatUptime(data.uptime_sec as number)}`);
      console.log(`  Events today:     ${data.events_today}`);
      console.log(`  Deep reads:       ${data.deep_reads_today}`);
      console.log(`  Context switches: ${data.context_switches_today}`);
      console.log(`  Browse time:      ${formatUptime(data.browse_time_today_sec as number)}`);
      console.log(`  Chat messages:    ${data.chat_messages_today}`);
      console.log(`  Pending events:   ${data.events_pending}`);
    } catch {
      // HTTP 请求失败 — daemon 进程存在但 HTTP 服务可能还没就绪
      console.log(`Daemon is running (PID: ${pid}) but HTTP API is not responding.`);
      console.log(`Tried: ${url}`);
    }
  });
