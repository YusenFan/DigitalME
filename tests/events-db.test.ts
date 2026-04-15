/**
 * events-db.test.ts — SQLite 事件存储层测试
 *
 * 测试事件的插入、查询、统计等操作。
 * 使用临时数据库文件避免污染真实数据。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// 使用临时目录创建测试数据库
const TEST_DB_PATH = path.join(os.tmpdir(), `persona-test-${Date.now()}.sqlite`);

/**
 * 直接用 better-sqlite3 创建一个测试数据库，
 * 复刻 events.ts 中的 schema。
 */
function createTestDb() {
  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type      TEXT    NOT NULL,
      url             TEXT,
      title           TEXT,
      excerpt         TEXT,
      dwell_time_sec  INTEGER,
      source          TEXT    NOT NULL DEFAULT 'browser',
      status          TEXT    NOT NULL DEFAULT 'pending',
      tags            TEXT,
      metadata        TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      classified_at   TEXT,
      dreaming_run_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_status  ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);
  `);

  return db;
}

describe("events.sqlite operations", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // 清理 WAL 文件
    const walPath = TEST_DB_PATH + "-wal";
    const shmPath = TEST_DB_PATH + "-shm";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  it("should insert a single event", () => {
    const stmt = db.prepare(`
      INSERT INTO events (event_type, url, title, excerpt, dwell_time_sec, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run("page_visit", "https://example.com", "Example", "Content here", 120, "browser");
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  it("should insert batch events in transaction", () => {
    const stmt = db.prepare(`
      INSERT INTO events (event_type, url, title, dwell_time_sec, source)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertBatch = db.transaction((items: Array<[string, string, string, number, string]>) => {
      const ids: number[] = [];
      for (const item of items) {
        const result = stmt.run(...item);
        ids.push(Number(result.lastInsertRowid));
      }
      return ids;
    });

    const ids = insertBatch([
      ["page_visit", "https://a.com", "Page A", 60, "browser"],
      ["page_visit", "https://b.com", "Page B", 300, "browser"],
      ["tab_switch", "https://c.com", "Page C", 0, "browser"],
    ]);

    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id > 0)).toBe(true);
  });

  it("should query events by status", () => {
    const rows = db
      .prepare("SELECT * FROM events WHERE status = ? ORDER BY created_at DESC")
      .all("pending");
    expect(rows.length).toBeGreaterThanOrEqual(4); // 1 + 3 from previous tests
  });

  it("should compute today stats correctly", () => {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total_events,
        SUM(CASE WHEN event_type = 'page_visit' AND dwell_time_sec > 300 THEN 1 ELSE 0 END) AS deep_reads,
        SUM(CASE WHEN event_type = 'tab_switch' THEN 1 ELSE 0 END) AS context_switches,
        COALESCE(SUM(CASE WHEN event_type = 'page_visit' THEN dwell_time_sec ELSE 0 END), 0) AS total_browse_sec
      FROM events
      WHERE created_at >= date('now')
    `).get() as Record<string, number>;

    expect(row.total_events).toBeGreaterThanOrEqual(4);
    expect(row.deep_reads).toBeGreaterThanOrEqual(0);
    expect(row.context_switches).toBeGreaterThanOrEqual(1);
    expect(row.total_browse_sec).toBeGreaterThanOrEqual(0);
  });

  it("should mark events as classified", () => {
    const event = db.prepare("SELECT id FROM events WHERE status = 'pending' LIMIT 1").get() as { id: number };

    db.prepare(`
      UPDATE events SET status = 'classified', tags = ?, classified_at = datetime('now'), dreaming_run_id = ?
      WHERE id = ?
    `).run(JSON.stringify(["coding/test", "testing"]), "run-test-001", event.id);

    const updated = db.prepare("SELECT * FROM events WHERE id = ?").get(event.id) as Record<string, unknown>;
    expect(updated.status).toBe("classified");
    expect(JSON.parse(updated.tags as string)).toEqual(["coding/test", "testing"]);
    expect(updated.dreaming_run_id).toBe("run-test-001");
  });

  it("should extract unique tags from classified events", () => {
    const rows = db.prepare(
      "SELECT DISTINCT tags FROM events WHERE tags IS NOT NULL AND status = 'classified'"
    ).all() as Array<{ tags: string }>;

    const tagSet = new Set<string>();
    for (const row of rows) {
      const parsed = JSON.parse(row.tags) as string[];
      for (const tag of parsed) {
        tagSet.add(tag);
      }
    }

    expect(tagSet.has("coding/test")).toBe(true);
    expect(tagSet.has("testing")).toBe(true);
  });
});
