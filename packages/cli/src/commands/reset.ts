/**
 * commands/reset.ts — `persona reset` 命令
 *
 * 完全清除所有 persona 数据（events.sqlite、USER.md、memory/、config.json）。
 * 需要用户确认才会执行，防止误操作。
 * --force 跳过确认直接删除。
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { DATA_DIR, PID_FILE } from "../../../daemon/src/config.js";

/**
 * 交互式确认。返回 true 表示用户确认。
 */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export const resetCommand = new Command("reset")
  .description("Wipe all persona data (events, USER.md, memory, config)")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (options) => {
    // 检查 daemon 是否在运行
    if (fs.existsSync(PID_FILE)) {
      const pid = fs.readFileSync(PID_FILE, "utf-8").trim();
      try {
        process.kill(parseInt(pid, 10), 0);
        console.log("Daemon is still running. Stop it first with \"persona stop\".");
        process.exit(1);
      } catch {
        // 进程已不在，继续
      }
    }

    if (!fs.existsSync(DATA_DIR)) {
      console.log("No data directory found. Nothing to reset.");
      return;
    }

    if (!options.force) {
      console.log(`This will permanently delete all data in:\n  ${DATA_DIR}\n`);
      console.log("Including: events.sqlite, USER.md, memory/, config.json");
      const ok = await confirm("\nAre you sure? (y/N) ");
      if (!ok) {
        console.log("Reset cancelled.");
        return;
      }
    }

    // 递归删除整个数据目录
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log("All persona data has been deleted.");
    console.log("Run \"persona onboard\" to start fresh.");
  });
