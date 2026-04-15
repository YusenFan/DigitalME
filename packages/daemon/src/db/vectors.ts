/**
 * db/vectors.ts — 向量存储与语义搜索
 *
 * 为 memory/ 文件生成 embedding 向量，存储在 SQLite 中。
 * 使用余弦相似度实现 top-k 语义搜索。
 *
 * 不依赖 sqlite-vec 扩展 — 纯 JavaScript 实现余弦相似度，
 * 避免 native 扩展的安装问题。向量以 JSON 数组存储在 TEXT 字段中。
 */

import { getDatabase } from "./events.js";
import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { PersonaConfig } from "../config.js";

// ── 类型定义 ────────────────────────────────────────────

/** 向量存储表中的一行 */
export interface VectorRow {
  id: number;
  file_path: string; // 相对于 memory/ 的路径
  chunk_text: string; // 文本块内容
  embedding: string; // JSON 数组字符串
  updated_at: string;
}

/** 语义搜索结果 */
export interface SearchResult {
  file_path: string;
  chunk_text: string;
  similarity: number; // 0-1，越大越相关
}

// ── 表初始化 ────────────────────────────────────────────

/**
 * 初始化向量表。在 initDatabase() 之后调用。
 */
export function initVectorTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path  TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding  TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(file_path)
    );

    CREATE INDEX IF NOT EXISTS idx_vectors_path ON memory_vectors(file_path);
  `);
}

// ── Embedding 生成 ──────────────────────────────────────

/**
 * 为一段文本生成 embedding 向量。
 * 使用 Vercel AI SDK 的 embed() 函数，支持多 provider。
 */
export async function generateEmbedding(
  text: string,
  config: PersonaConfig
): Promise<number[]> {
  const openai = createOpenAI({ apiKey: config.llm.apiKey });
  const model = openai.embedding(config.embedding.model);

  const { embedding } = await embed({ model, value: text });
  return embedding;
}

/**
 * 批量生成 embedding。
 * 逐个处理避免 rate limit（memory/ 文件通常不多）。
 */
export async function generateEmbeddings(
  texts: string[],
  config: PersonaConfig
): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const emb = await generateEmbedding(text, config);
    results.push(emb);
  }
  return results;
}

// ── 存储操作 ────────────────────────────────────────────

/**
 * 插入或更新单个 memory 文件的向量。
 * 使用 UPSERT — 文件路径重复时更新。
 */
export function upsertVector(
  filePath: string,
  chunkText: string,
  embedding: number[]
): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO memory_vectors (file_path, chunk_text, embedding, updated_at)
    VALUES (@filePath, @chunkText, @embedding, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET
      chunk_text = @chunkText,
      embedding  = @embedding,
      updated_at = datetime('now')
  `).run({
    filePath,
    chunkText,
    embedding: JSON.stringify(embedding),
  });
}

/**
 * 删除已不存在的 memory 文件的向量。
 */
export function removeVector(filePath: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM memory_vectors WHERE file_path = ?").run(filePath);
}

/**
 * 获取所有已存储的向量记录。
 */
export function getAllVectors(): VectorRow[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM memory_vectors").all() as VectorRow[];
}

/**
 * 获取所有已索引的文件路径。
 */
export function getIndexedPaths(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT file_path FROM memory_vectors")
    .all() as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

// ── 语义搜索 ────────────────────────────────────────────

/**
 * 余弦相似度计算。
 * 对归一化向量（OpenAI embedding 已归一化）等价于点积。
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 语义搜索：找到与查询最相关的 top-k 个 memory 文件。
 *
 * @param queryEmbedding - 查询文本的向量
 * @param topK           - 返回结果数量（默认 5）
 * @param minSimilarity  - 最低相似度阈值（默认 0.3）
 */
export function semanticSearch(
  queryEmbedding: number[],
  topK = 5,
  minSimilarity = 0.3
): SearchResult[] {
  const allVectors = getAllVectors();

  const scored = allVectors
    .map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      return {
        file_path: row.file_path,
        chunk_text: row.chunk_text,
        similarity: cosineSimilarity(queryEmbedding, emb),
      };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}

// ── 索引同步 ────────────────────────────────────────────

/**
 * 同步 memory/ 文件到向量索引。
 *
 * 逻辑：
 * 1. 列出所有 memory/ 文件
 * 2. 对比已索引文件，找出需要新增/更新/删除的
 * 3. 为需要更新的文件生成 embedding
 * 4. 更新向量表
 *
 * @param memoryFiles - 所有 memory 文件内容 {path, content}
 * @param config      - 配置（用于 embedding API）
 * @param onProgress  - 进度回调
 */
export async function syncVectorIndex(
  memoryFiles: Array<{ path: string; content: string }>,
  config: PersonaConfig,
  onProgress?: (msg: string) => void
): Promise<{ added: number; updated: number; removed: number }> {
  const indexedPaths = new Set(getIndexedPaths());
  const currentPaths = new Set(memoryFiles.map((f) => f.path));
  let added = 0;
  let updated = 0;
  let removed = 0;

  // 删除已不存在的文件
  for (const p of indexedPaths) {
    if (!currentPaths.has(p)) {
      removeVector(p);
      removed++;
    }
  }

  // 新增或更新
  for (const file of memoryFiles) {
    onProgress?.(`Embedding: ${file.path}`);
    // 截取前 8000 字符避免 token 超限
    const text = file.content.slice(0, 8000);
    const embedding = await generateEmbedding(text, config);
    upsertVector(file.path, text, embedding);
    if (indexedPaths.has(file.path)) {
      updated++;
    } else {
      added++;
    }
  }

  return { added, updated, removed };
}
