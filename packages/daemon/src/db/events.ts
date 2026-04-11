/**
 * db/events.ts — SQLite 事件存储层
 *
 * 负责 events.sqlite 的初始化、表创建、以及所有 CRUD 操作。
 * 使用 better-sqlite3（同步 API，单用户本地应用足够高效）。
 *
 * 表结构遵循 PRD §4.1 定义。
 */

import Database from "better-sqlite3";
import { DB_PATH, ensureDataDir } from "../config.js";

// ── 类型定义 ────────────────────────────────────────────

/** 事件类型枚举 — 对应 event_type 字段的合法值 */
export type EventType =
  | "page_visit" // 浏览器页面访问
  | "tab_switch" // 标签页切换
  | "chat_message" // 聊天消息
  | "context_switch"; // 上下文切换（如从浏览器切到 IDE）

/** 事件状态 — 追踪处理流程 */
export type EventStatus =
  | "pending" // 待处理（dreaming 还没分类）
  | "classified" // 已分类
  | "archived"; // 已归档

/** 插入新事件时的输入结构（id、时间戳等由数据库自动生成） */
export interface InsertEventInput {
  event_type: EventType;
  url?: string;
  title?: string;
  excerpt?: string; // Readability.js 提取的内容摘要
  dwell_time_sec?: number;
  source?: string; // 来源：'browser' | 'chat' | 'directory_scan'
  metadata?: Record<string, unknown>; // 额外数据，JSON 存储
}

/** 数据库中存储的完整事件记录 */
export interface EventRow {
  id: number;
  event_type: string;
  url: string | null;
  title: string | null;
  excerpt: string | null;
  dwell_time_sec: number | null;
  source: string;
  status: string;
  tags: string | null; // JSON 数组字符串
  metadata: string | null; // JSON 字符串
  created_at: string;
  classified_at: string | null;
  dreaming_run_id: string | null;
}

/** 今日统计摘要 — 用于 TUI 面板和 /api/status */
export interface TodayStats {
  total_events: number;
  deep_reads: number; // dwell_time > 300s（5分钟）的页面访问
  context_switches: number;
  total_browse_sec: number; // 总浏览时间（秒）
  chat_messages: number;
  pending_count: number; // 等待 dreaming 处理的事件数
}

// ── 数据库实例 ──────────────────────────────────────────

/** 模块级数据库实例，由 initDatabase() 初始化 */
let db: Database.Database | null = null;

// ── 初始化 ──────────────────────────────────────────────

/**
 * 初始化 SQLite 数据库。
 *
 * 操作：
 * 1. 确保数据目录存在
 * 2. 打开数据库文件（不存在则自动创建）
 * 3. 启用 WAL 模式（提升并发读写性能，崩溃恢复更好）
 * 4. 创建 events 表和索引（IF NOT EXISTS，幂等）
 */
export function initDatabase(): Database.Database {
  ensureDataDir();
  db = new Database(DB_PATH);

  // WAL (Write-Ahead Logging) 模式：
  // - 读操作不阻塞写操作
  // - 崩溃后数据库更容易恢复
  db.pragma("journal_mode = WAL");

  // 创建 events 表 — 按 PRD §4.1 schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type      TEXT    NOT NULL,                         -- 'page_visit', 'tab_switch', 'chat_message', 'context_switch'
      url             TEXT,                                     -- 完整 URL（非浏览器事件为 null）
      title           TEXT,                                     -- 页面标题或消息预览
      excerpt         TEXT,                                     -- Readability.js 提取的内容（最多 1000 字符）
      dwell_time_sec  INTEGER,                                  -- 停留时间（秒），非停留类事件为 null
      source          TEXT    NOT NULL DEFAULT 'browser',       -- 来源标识
      status          TEXT    NOT NULL DEFAULT 'pending',       -- 处理状态
      tags            TEXT,                                     -- JSON 数组（分类后填入）
      metadata        TEXT,                                     -- JSON blob，存放事件类型特有的数据
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      classified_at   TEXT,                                     -- dreaming 分类完成的时间
      dreaming_run_id TEXT                                      -- 哪一次 dreaming 处理的
    );

    -- 按状态查询（dreaming 需要快速获取所有 pending 事件）
    CREATE INDEX IF NOT EXISTS idx_events_status  ON events(status);
    -- 按时间查询（时间线展示、范围查询）
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    -- 按类型查询
    CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);
  `);

  return db;
}

/**
 * 获取数据库实例。如果还没初始化会抛错。
 * 不自动初始化是为了让调用者明确控制生命周期。
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * 关闭数据库连接。daemon 关闭时调用。
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ── CRUD 操作 ───────────────────────────────────────────

/**
 * 插入单个事件。
 *
 * @returns 新插入事件的 id
 */
export function insertEvent(input: InsertEventInput): number {
  const d = getDatabase();

  const stmt = d.prepare(`
    INSERT INTO events (event_type, url, title, excerpt, dwell_time_sec, source, metadata)
    VALUES (@event_type, @url, @title, @excerpt, @dwell_time_sec, @source, @metadata)
  `);

  const result = stmt.run({
    event_type: input.event_type,
    url: input.url ?? null,
    title: input.title ?? null,
    excerpt: input.excerpt ?? null,
    dwell_time_sec: input.dwell_time_sec ?? null,
    source: input.source ?? "browser",
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * 批量插入事件。
 * 包裹在事务中 — 要么全部成功，要么全部回滚。
 *
 * @returns 所有新插入事件的 id 数组
 */
export function insertEventBatch(inputs: InsertEventInput[]): number[] {
  const d = getDatabase();
  const ids: number[] = [];

  // better-sqlite3 的 transaction() 自动开始和提交事务
  const batchInsert = d.transaction((events: InsertEventInput[]) => {
    for (const input of events) {
      const id = insertEvent(input);
      ids.push(id);
    }
  });

  batchInsert(inputs);
  return ids;
}

/**
 * 查询指定状态的事件。
 *
 * @param status  事件状态
 * @param limit   最多返回多少条（默认 1000）
 */
export function getEventsByStatus(
  status: EventStatus,
  limit = 1000
): EventRow[] {
  const d = getDatabase();
  return d
    .prepare("SELECT * FROM events WHERE status = ? ORDER BY created_at DESC LIMIT ?")
    .all(status, limit) as EventRow[];
}

/**
 * 获取最近的 N 个事件（不限状态），用于 TUI 事件流显示。
 */
export function getRecentEvents(limit = 50): EventRow[] {
  const d = getDatabase();
  return d
    .prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?")
    .all(limit) as EventRow[];
}

/**
 * 获取今日统计摘要。
 *
 * "今日" 定义为 UTC 当天 00:00 至现在。
 * 返回事件数、深度阅读数、上下文切换数、总浏览时间、聊天消息数、待处理数。
 */
export function getTodayStats(): TodayStats {
  const d = getDatabase();

  // date('now') 返回 UTC 日期如 '2026-04-11'
  // created_at >= date('now') 匹配今天的所有事件
  const row = d
    .prepare(
      `
      SELECT
        COUNT(*)                                                    AS total_events,
        SUM(CASE WHEN event_type = 'page_visit'
                  AND dwell_time_sec > 300 THEN 1 ELSE 0 END)      AS deep_reads,
        SUM(CASE WHEN event_type = 'context_switch' THEN 1 ELSE 0 END) AS context_switches,
        COALESCE(SUM(CASE WHEN event_type = 'page_visit'
                          THEN dwell_time_sec ELSE 0 END), 0)      AS total_browse_sec,
        SUM(CASE WHEN event_type = 'chat_message' THEN 1 ELSE 0 END)   AS chat_messages,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)        AS pending_count
      FROM events
      WHERE created_at >= date('now')
    `
    )
    .get() as Record<string, number>;

  return {
    total_events: row.total_events ?? 0,
    deep_reads: row.deep_reads ?? 0,
    context_switches: row.context_switches ?? 0,
    total_browse_sec: row.total_browse_sec ?? 0,
    chat_messages: row.chat_messages ?? 0,
    pending_count: row.pending_count ?? 0,
  };
}
