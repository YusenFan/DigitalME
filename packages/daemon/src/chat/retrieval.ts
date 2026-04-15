/**
 * chat/retrieval.ts — Memory-augmented 检索
 *
 * 语义搜索 memory/ 文件，返回与用户查询最相关的上下文。
 * 用于注入到聊天系统提示中，让 LLM 具备深度用户理解。
 */

import fs from "node:fs";
import path from "node:path";
import { generateEmbedding, semanticSearch, type SearchResult } from "../db/vectors.js";
import { readUserMd, MEMORY_DIR } from "../dreaming/updater.js";
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
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(query, config);

    // 语义搜索
    const results = semanticSearch(queryEmbedding, topK);

    // 读取命中文件的完整内容（向量表中存的是截断版本）
    memoryChunks = results.map((r) => {
      const fullPath = path.join(MEMORY_DIR, r.file_path);
      let content = r.chunk_text;
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, "utf-8");
      }
      return {
        path: r.file_path,
        content,
        similarity: r.similarity,
      };
    });
  } catch {
    // embedding API 不可用时仍能聊天，只是没有 memory 增强
  }

  return { userMd, memoryChunks };
}
