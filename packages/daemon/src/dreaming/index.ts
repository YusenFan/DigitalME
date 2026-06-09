/**
 * dreaming/index.ts — Dreaming 主编排器
 *
 * 完整的 dreaming pipeline：
 *   1. 获取 pending 事件
 *   2. 分类（classifier）
 *   3. 标记事件为 classified，写入 tags
 *   4. 推断行为模式（inferrer）
 *   5. 更新 USER.md（updater）
 *   6. 更新 memory/ 文件（updater）
 *   7. 时间衰减（decay）
 *   8. 压缩 USER.md（compressor，如果超预算）
 *   9. 生成报告
 *
 * 设计要点：
 *   - 运行锁：同一时间只能有一个 dreaming 运行
 *   - 唯一 run ID（时间戳）用于关联事件和日志
 *   - 进度回调：让 TUI/CLI 能显示实时进度
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig, DATA_DIR } from "../config.js";
import {
  getAllTags,
  getPendingEventsSince,
  markEventsClassified,
  getClassifiedEventsSince,
} from "../db/events.js";
import { classifyEvents } from "./classifier.js";
import { inferPatterns } from "./inferrer.js";
import { readUserMd, updateUserMd, updateMemoryFiles, ensureMemoryDir, MEMORY_DIR } from "./updater.js";
import { applyDecay, type DecayResult } from "./decay.js";
import { compressUserMdIfNeeded, estimateTokens } from "./compressor.js";
import type { LlmClientOptions } from "../onboarding/llm.js";

// ── 类型定义 ────────────────────────────────────────────

/** Dreaming 进度事件 — 回调给 TUI/CLI 显示 */
export interface DreamingProgress {
  stage:
    | "start"
    | "classifying"
    | "classify_batch"
    | "marking"
    | "inferring"
    | "updating_user_md"
    | "updating_memory"
    | "decaying"
    | "compressing"
    | "done"
    | "error";
  message: string;
  detail?: string;
}

/** Dreaming 运行报告 */
export interface DreamingReport {
  runId: string;
  startTime: string;
  endTime: string;
  durationSec: number;
  eventsProcessed: number;
  classificationsCount: number;
  newTags: string[];
  patternsFound: number;
  memoryFilesUpdated: string[];
  decayResults: DecayResult[];
  compressed: boolean;
  userMdTokens: number;
}

// ── 运行锁 ──────────────────────────────────────────────

const LOCK_FILE = path.join(DATA_DIR, "dreaming.lock");

function acquireLock(runId: string): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    // 检查锁是否过期（超过 30 分钟视为僵尸锁）
    const stat = fs.statSync(LOCK_FILE);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30 * 60 * 1000) {
      return false; // 锁还有效，拒绝获取
    }
    // 僵尸锁，强制释放
  }
  fs.writeFileSync(LOCK_FILE, runId, "utf-8");
  return true;
}

function releaseLock(): void {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

// ── 主流程 ──────────────────────────────────────────────

/**
 * 执行完整的 dreaming pipeline。
 *
 * @param since       可选的时间过滤器（ISO 字符串），只处理该时间之后的事件
 * @param onProgress  进度回调
 * @returns dreaming 报告
 */
export async function runDreaming(
  since?: string,
  onProgress?: (progress: DreamingProgress) => void
): Promise<DreamingReport> {
  const runId = `dream-${Date.now()}`;
  const startTime = new Date().toISOString();

  // 获取锁
  if (!acquireLock(runId)) {
    throw new Error("Another dreaming run is in progress. Wait or delete dreaming.lock manually.");
  }

  const report: DreamingReport = {
    runId,
    startTime,
    endTime: "",
    durationSec: 0,
    eventsProcessed: 0,
    classificationsCount: 0,
    newTags: [],
    patternsFound: 0,
    memoryFilesUpdated: [],
    decayResults: [],
    compressed: false,
    userMdTokens: 0,
  };

  try {
    const config = loadConfig();
    const llmConfig: LlmClientOptions = {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
    };

    // ── 1. 获取 pending 事件 ─────────────────────
    onProgress?.({ stage: "start", message: "Dreaming started", detail: runId });

    const pendingEvents = getPendingEventsSince(since);
    if (pendingEvents.length === 0) {
      onProgress?.({ stage: "done", message: "No pending events to process" });
      report.endTime = new Date().toISOString();
      releaseLock();
      return report;
    }

    report.eventsProcessed = pendingEvents.length;
    onProgress?.({
      stage: "classifying",
      message: `Classifying ${pendingEvents.length} events...`,
    });

    // ── 2. 分类 ──────────────────────────────────
    const existingTags = getAllTags();
    const classResult = await classifyEvents(
      pendingEvents,
      existingTags,
      llmConfig,
      (current, total) => {
        onProgress?.({
          stage: "classify_batch",
          message: `Classifying batch ${current}/${total}...`,
        });
      }
    );

    report.classificationsCount = classResult.classifications.length;
    report.newTags = classResult.new_tags.map((t) => t.tag);

    // ── 3. 标记事件为 classified ─────────────────
    onProgress?.({ stage: "marking", message: "Saving classifications..." });

    const updates = classResult.classifications.map((c) => ({
      id: c.event_id,
      tags: c.tags,
    }));
    markEventsClassified(updates, runId);

    // ── 4. 推断行为模式 ──────────────────────────
    onProgress?.({ stage: "inferring", message: "Inferring patterns..." });

    // 获取最近 7 天的所有 classified 事件（包括刚分类的）用于模式推断
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentClassified = getClassifiedEventsSince(sevenDaysAgo);
    const currentUserMd = readUserMd();

    const inference = await inferPatterns(recentClassified, currentUserMd, llmConfig);
    report.patternsFound = inference.patterns.length;

    // ── 5. 更新 USER.md ─────────────────────────
    onProgress?.({ stage: "updating_user_md", message: "Updating USER.md..." });
    await updateUserMd(currentUserMd, inference, llmConfig);

    // ── 6. 更新 memory/ 文件 ────────────────────
    if (inference.memory_updates.length > 0) {
      onProgress?.({
        stage: "updating_memory",
        message: `Updating ${inference.memory_updates.length} memory files...`,
      });
      const updatedFiles = await updateMemoryFiles(inference.memory_updates, config);
      report.memoryFilesUpdated = updatedFiles;
    }

    // ── 7. 时间衰减 ─────────────────────────────
    onProgress?.({ stage: "decaying", message: "Applying temporal decay..." });
    report.decayResults = applyDecay(config.dreaming.decayHalfLifeDays);

    // ── 8. 压缩 USER.md（如果超预算）────────────
    onProgress?.({ stage: "compressing", message: "Checking USER.md size..." });
    const compressResult = await compressUserMdIfNeeded(
      config.dreaming.userMdTokenBudget,
      llmConfig
    );
    report.compressed = compressResult.compressed;
    report.userMdTokens = compressResult.afterTokens;

    // ── 9. 生成报告 ─────────────────────────────
    report.endTime = new Date().toISOString();
    report.durationSec = Math.round(
      (new Date(report.endTime).getTime() - new Date(report.startTime).getTime()) / 1000
    );

    // 写入 dreaming log
    writeDreamingLog(report);

    onProgress?.({
      stage: "done",
      message: `Done! ${report.eventsProcessed} events, ${report.patternsFound} patterns, ${report.durationSec}s`,
    });

    return report;
  } catch (err) {
    onProgress?.({
      stage: "error",
      message: `Dreaming failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  } finally {
    releaseLock();
  }
}

/**
 * 将 dreaming 报告追加到 memory/meta/dreaming-log.md。
 */
function writeDreamingLog(report: DreamingReport): void {
  ensureMemoryDir();
  const logPath = path.join(MEMORY_DIR, "meta", "dreaming-log.md");

  const tagSummary =
    report.newTags.length > 0
      ? `New tags: ${report.newTags.join(", ")}`
      : "No new tags";

  const decaySummary = report.decayResults
    .filter((d) => d.oldWeight - d.newWeight > 0.01)
    .map((d) => `  - ${d.file}: ${d.oldWeight} → ${d.newWeight}`)
    .join("\n");

  const entry = `
## ${report.startTime.split("T")[0]} — ${report.runId}

- **Events processed:** ${report.eventsProcessed}
- **Classifications:** ${report.classificationsCount}
- **${tagSummary}**
- **Patterns found:** ${report.patternsFound}
- **Memory files updated:** ${report.memoryFilesUpdated.length > 0 ? report.memoryFilesUpdated.join(", ") : "none"}
- **Compressed:** ${report.compressed ? "yes" : "no"} (${report.userMdTokens} tokens)
- **Duration:** ${report.durationSec}s
${decaySummary ? `- **Decay changes:**\n${decaySummary}` : ""}

---
`;

  // 追加到日志文件
  let existing = "";
  if (fs.existsSync(logPath)) {
    existing = fs.readFileSync(logPath, "utf-8");
  } else {
    existing = "# Dreaming Log\n\nAutomatically generated by the dreaming agent.\n\n---\n";
  }

  fs.writeFileSync(logPath, existing + entry, "utf-8");
}
