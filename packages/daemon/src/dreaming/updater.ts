/**
 * dreaming/updater.ts — USER.md + memory/ 更新器
 *
 * 根据 inferrer 的输出：
 *   1. 更新 USER.md（使用 LLM 重写，保持模板结构）
 *   2. 将 memory 更新交给 mem0 管理
 *
 * USER.md 更新策略：整体重写而非正则替换，
 * 因为自然语言段落不适合结构化 patch。
 */

import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { createLlmModel, type LlmClientOptions } from "../onboarding/llm.js";
import { DATA_DIR, USER_MD_PATH, type PersonaConfig } from "../config.js";
import { addMemoryUpdates } from "../memory/mem0.js";
import type { InferrerOutput, MemoryUpdate } from "./inferrer.js";

/** memory/ 根目录 */
export const MEMORY_DIR = path.join(DATA_DIR, "memory");

/**
 * 确保 memory/ 目录及 meta/ 子目录存在。
 */
export function ensureMemoryDir(): void {
  const metaDir = path.join(MEMORY_DIR, "meta");
  if (!fs.existsSync(metaDir)) {
    fs.mkdirSync(metaDir, { recursive: true });
  }
}

/**
 * 使用 LLM 重写 USER.md。
 *
 * 将当前内容 + inferrer 的更新建议一起发给 LLM，
 * 由 LLM 生成更新后的完整 USER.md。
 */
export async function updateUserMd(
  currentContent: string,
  inference: InferrerOutput,
  llmConfig: LlmClientOptions
): Promise<string> {
  const model = createLlmModel(llmConfig);

  const systemPrompt = `You are a persona updater for a personal behavioral modeling system.
Your task is to update the USER.md file based on new behavioral patterns detected.

## Rules
1. Keep the EXACT template structure (all section headers must remain).
2. Integrate the suggested updates naturally into the existing content.
3. For Identity Tags: add new items, remove suggested ones. Keep the bracket list format.
4. For Behavioral Patterns: merge new observations with existing ones. Keep it concise.
5. For Current Context: update to reflect the latest activity. This should always be recent.
6. Do NOT add new sections. Do NOT remove existing sections.
7. Keep the file under 3000 tokens.
8. Output ONLY the markdown content, no explanations.`;

  const userPrompt = `## Current USER.md
${currentContent}

## Updates to Apply
### Patterns Detected
${JSON.stringify(inference.patterns, null, 2)}

### Identity Tag Changes
Add: ${JSON.stringify(inference.user_md_updates.identity_tags.add)}
Remove: ${JSON.stringify(inference.user_md_updates.identity_tags.remove)}

### Behavioral Pattern Updates
${inference.user_md_updates.behavioral_patterns.join("\n")}

### Current Context
Recent focus: ${inference.user_md_updates.current_context.recent_focus}
${inference.user_md_updates.current_context.active_projects ? `Active projects: ${inference.user_md_updates.current_context.active_projects.join(", ")}` : ""}

Please output the updated USER.md incorporating these changes.`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 4000,
    temperature: 0.4,
  });

  const updated = text.trim();

  // 写入文件
  fs.writeFileSync(USER_MD_PATH, updated + "\n", "utf-8");
  return updated;
}

/**
 * 读取当前 USER.md 内容。
 */
export function readUserMd(): string {
  if (!fs.existsSync(USER_MD_PATH)) {
    return "";
  }
  return fs.readFileSync(USER_MD_PATH, "utf-8");
}

/**
 * 根据 inferrer 的建议写入 mem0。
 */
export async function updateMemoryFiles(
  memoryUpdates: MemoryUpdate[],
  config: PersonaConfig
): Promise<string[]> {
  return addMemoryUpdates(memoryUpdates, config);
}
