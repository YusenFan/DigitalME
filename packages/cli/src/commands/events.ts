/**
 * commands/events.ts — `persona events` 命令
 *
 * 查询 events.sqlite 中的事件。
 *   --since <duration>  只显示指定时间范围内的事件（如 2h, 1d, 7d）
 *   --status <status>   按状态过滤（pending, classified, archived）
 *   --limit <n>         最多显示多少条（默认 50）
 *   --type <type>       按事件类型过滤
 */

import { Command } from "commander";
import { initDatabase, getDatabase } from "../../../daemon/src/db/events.js";

import type { EventRow } from "../../../daemon/src/db/events.js";

/**
 * 将 duration 字符串（如 "2h", "1d", "7d"）转换为 ISO 时间字符串。
 */
function parseSince(since: string): string {
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) {
    console.error(`Invalid duration format: "${since}". Use formats like 2h, 1d, 7d.`);
    process.exit(1);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  if (unit === "h") {
    now.setHours(now.getHours() - value);
  } else {
    now.setDate(now.getDate() - value);
  }

  return now.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * 截断字符串到指定长度。
 */
function truncate(str: string | null, maxLen: number): string {
  if (!str) return "—";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

/**
 * 格式化单个事件为终端输出行。
 */
function formatEvent(event: EventRow): string {
  const time = event.created_at.slice(11, 16); // HH:MM
  const date = event.created_at.slice(0, 10);  // YYYY-MM-DD
  const type = event.event_type.padEnd(14);
  const status = event.status.padEnd(10);
  const title = truncate(event.title, 50);
  const dwell = event.dwell_time_sec ? `${event.dwell_time_sec}s` : "";
  const tags = event.tags ? JSON.parse(event.tags).join(", ") : "";

  return `  ${date} ${time}  ${type}  ${status}  ${title}  ${dwell}  ${tags}`;
}

export const eventsCommand = new Command("events")
  .description("Query stored events")
  .option("-s, --since <duration>", "Time range (e.g., 2h, 1d, 7d)")
  .option("--status <status>", "Filter by status (pending, classified, archived)")
  .option("-t, --type <type>", "Filter by event type (page_visit, chat_message, etc.)")
  .option("-l, --limit <n>", "Max events to show", "50")
  .action((options) => {
    initDatabase();
    const db = getDatabase();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.since) {
      const sinceTime = parseSince(options.since);
      conditions.push("created_at >= ?");
      params.push(sinceTime);
    }

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    if (options.type) {
      conditions.push("event_type = ?");
      params.push(options.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = parseInt(options.limit, 10) || 50;

    const rows = db
      .prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as EventRow[];

    if (rows.length === 0) {
      console.log("No events found.");
      return;
    }

    // 统计
    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM events ${where}`)
      .get(...params) as { count: number };

    console.log(`Events (showing ${rows.length} of ${totalRow.count}):`);
    console.log("─".repeat(90));
    console.log(`  ${"Date".padEnd(10)} ${"Time".padEnd(5)}  ${"Type".padEnd(14)}  ${"Status".padEnd(10)}  ${"Title".padEnd(50)}  ${"Dwell"}  Tags`);
    console.log("─".repeat(90));

    for (const event of rows) {
      console.log(formatEvent(event));
    }
  });
