/**
 * chat/retrieval.ts — Memory-augmented 检索
 *
 * 语义搜索 memory/ 文件，返回与用户查询最相关的上下文。
 * 用于注入到聊天系统提示中，让 LLM 具备深度用户理解。
 */

import { searchMemories } from "../memory/mem0.js";
import { readUserMd } from "../dreaming/updater.js";
import type { PersonaConfig } from "../config.js";

/** 检索结果 — 用于构建系统提示 */
export interface RetrievalContext {
  /** USER.md 全文（始终包含） */
  userMd: string;
  /** 语义搜索命中的 memory 片段 */
  memoryChunks: Array<{
    path: string;
    content: string;
    similarity: number;
  }>;
}

/**
 * 根据用户查询检索相关上下文。
 *
 * 流程：
 * 1. 读取 USER.md（始终包含在上下文中）
 * 2. 为查询生成 embedding
 * 3. 在向量索引中搜索 top-k 最相关的 memory 文件
 * 4. 读取命中文件的完整内容
 *
 * @param query  用户的聊天消息
 * @param config 配置（用于 embedding API）
 * @param topK   返回多少个最相关的 memory 文件（默认 5）
 */
export async function retrieveContext(
  query: string,
  config: PersonaConfig,
  topK = 5
): Promise<RetrievalContext> {
  const userMd = readUserMd();

  let memoryChunks: RetrievalContext["memoryChunks"] = [];

  try {
    const results = await searchMemories(query, config, topK);

    memoryChunks = results.map((r) => {
      return {
        path: r.path,
        content: r.content,
        similarity: r.score ?? 0,
      };
    });
  } catch {
    // embedding API 不可用时仍能聊天，只是没有 memory 增强
  }

  return { userMd, memoryChunks };
}
