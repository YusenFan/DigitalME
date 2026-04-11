/**
 * commands/stop.ts — `persona stop` 命令
 *
 * 停止正在运行的 daemon 进程。
 * 通过读取 PID 文件获取进程 ID，然后发送 SIGTERM 信号。
 * daemon 收到 SIGTERM 后会 graceful shutdown（关闭 HTTP、数据库、删除 PID 文件）。
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PID_FILE = path.join(os.homedir(), ".persona-engine", "daemon.pid");

export const stopCommand = new Command("stop")
  .description("Stop the running Persona Engine daemon")
  .action(() => {
    // PID 文件不存在 → daemon 没在运行
    if (!fs.existsSync(PID_FILE)) {
      console.log("Daemon is not running (no PID file found).");
      process.exit(1);
    }

    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) {
      console.log("Invalid PID file. Removing it.");
      fs.unlinkSync(PID_FILE);
      process.exit(1);
    }

    try {
      // 发送 SIGTERM — daemon 会 graceful shutdown
      process.kill(pid, "SIGTERM");
      console.log(`Daemon stopped (sent SIGTERM to PID ${pid}).`);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ESRCH") {
        // 进程已经不存在 — 清理残留的 PID 文件
        console.log("Daemon process not found. Cleaning up PID file.");
        fs.unlinkSync(PID_FILE);
      } else {
        console.error("Failed to stop daemon:", error.message);
        process.exit(1);
      }
    }
  });
