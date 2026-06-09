/**
 * commands/dream.ts — `persona dream` 命令
 *
 * 手动触发 dreaming pipeline。
 * 可选 --since 参数指定只处理最近一段时间的事件。
 *
 * 与 daemon 内的调度 dreaming 不同，CLI dream 命令直接运行 pipeline，
 * 不需要 daemon 在运行（但需要数据库存在）。
 */

import { Command } from "commander";
import { loadConfig } from "../../../daemon/src/config.js";
import { initDatabase, closeDatabase } from "../../../daemon/src/db/events.js";
import type { DreamingProgress } from "../../../daemon/src/dreaming/index.js";

/**
 * 解析 --since 参数为 ISO 时间字符串。
 * 支持格式：2h, 30m, 1d, 3d
 */
function parseSince(since: string): string {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid --since format: "${since}". Use: 30m, 2h, 1d, 3d`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  let ms: number;

  switch (unit) {
    case "m":
      ms = value * 60 * 1000;
      break;
    case "h":
      ms = value * 60 * 60 * 1000;
      break;
    case "d":
      ms = value * 24 * 60 * 60 * 1000;
      break;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }

  return new Date(Date.now() - ms).toISOString();
}

/**
 * 格式化进度消息，输出到终端。
 */
function formatProgress(progress: DreamingProgress): string {
  const icons: Record<string, string> = {
    start: "🧠",
    classifying: "🏷️",
    classify_batch: "  📦",
    marking: "💾",
    inferring: "🔍",
    updating_user_md: "📝",
    updating_memory: "🗂️",
    decaying: "⏳",
    compressing: "📐",
    done: "✅",
    error: "❌",
  };

  const icon = icons[progress.stage] ?? "·";
  return `${icon} ${progress.message}`;
}

export const dreamCommand = new Command("dream")
  .description("Trigger dreaming — classify events and update persona")
  .option(
    "--since <duration>",
    "Only process events from the last duration (e.g., 2h, 1d)"
  )
  .action(async (options) => {
    try {
      // 加载配置并检查 API key
      const config = loadConfig();
      if (!config.llm.apiKey) {
        console.error(
          "❌ No LLM API key configured. Run 'persona onboard' first or edit config.json."
        );
        process.exit(1);
      }

      // 初始化数据库
      initDatabase();

      // 解析 --since
      let since: string | undefined;
      if (options.since) {
        since = parseSince(options.since);
        console.log(`Filtering events since: ${since}`);
      }

      console.log(""); // 空行，让输出更易读

      // 运行 dreaming
      const { runDreaming } = await import("../../../daemon/src/dreaming/index.js");
      const report = await runDreaming(since, (progress) => {
        console.log(formatProgress(progress));
      });

      // 打印摘要
      console.log("");
      console.log("── Dreaming Report ──────────────────────────");
      console.log(`  Events processed:   ${report.eventsProcessed}`);
      console.log(`  Classifications:    ${report.classificationsCount}`);
      console.log(`  New tags:           ${report.newTags.length > 0 ? report.newTags.join(", ") : "(none)"}`);
      console.log(`  Patterns found:     ${report.patternsFound}`);
      console.log(`  Memory files:       ${report.memoryFilesUpdated.length > 0 ? report.memoryFilesUpdated.join(", ") : "(none)"}`);
      console.log(`  USER.md tokens:     ~${report.userMdTokens}`);
      console.log(`  Duration:           ${report.durationSec}s`);
      console.log("─────────────────────────────────────────────");

      closeDatabase();
      process.exit(0);
    } catch (err) {
      console.error(
        `\n❌ Dreaming failed: ${err instanceof Error ? err.message : String(err)}`
      );
      closeDatabase();
      process.exit(1);
    }
  });
