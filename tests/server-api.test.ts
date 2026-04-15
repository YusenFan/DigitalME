/**
 * server-api.test.ts — HTTP API 集成测试
 *
 * 测试 daemon HTTP API 端点的请求/响应。
 * 使用真实 Fastify 实例 + 临时 SQLite 数据库。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// 临时测试数据库
const TEST_DB_PATH = path.join(os.tmpdir(), `persona-api-test-${Date.now()}.sqlite`);

/**
 * 创建一个简单的测试 Fastify 服务器，
 * 模拟 daemon 的核心事件 API。
 */
function createTestServer(db: Database.Database): FastifyInstance {
  const app = Fastify({ logger: false });

  const insertStmt = db.prepare(`
    INSERT INTO events (event_type, url, title, excerpt, dwell_time_sec, source)
    VALUES (@event_type, @url, @title, @excerpt, @dwell_time_sec, @source)
  `);

  app.post("/api/events", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const validTypes = ["page_visit", "tab_switch", "chat_message", "context_switch"];

    if (!body.event_type || !validTypes.includes(body.event_type as string)) {
      return reply.status(400).send({ error: "Invalid event_type" });
    }

    const result = insertStmt.run({
      event_type: body.event_type,
      url: body.url ?? null,
      title: body.title ?? null,
      excerpt: body.excerpt ?? null,
      dwell_time_sec: body.dwell_time_sec ?? null,
      source: "browser",
    });

    return reply.status(201).send({ id: Number(result.lastInsertRowid), status: "pending" });
  });

  app.post("/api/events/batch", async (request, reply) => {
    const { events } = request.body as { events: Array<Record<string, unknown>> };

    if (!Array.isArray(events) || events.length === 0) {
      return reply.status(400).send({ error: "events array required" });
    }

    const batchInsert = db.transaction((items: Array<Record<string, unknown>>) => {
      const ids: number[] = [];
      for (const item of items) {
        const result = insertStmt.run({
          event_type: item.event_type,
          url: item.url ?? null,
          title: item.title ?? null,
          excerpt: item.excerpt ?? null,
          dwell_time_sec: item.dwell_time_sec ?? null,
          source: "browser",
        });
        ids.push(Number(result.lastInsertRowid));
      }
      return ids;
    });

    const ids = batchInsert(events);
    return reply.status(201).send({ inserted: ids.length, ids });
  });

  app.get("/api/status", async () => {
    const row = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
    return { daemon: "running", events_total: row.count };
  });

  return app;
}

describe("HTTP API", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = new Database(TEST_DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        url TEXT, title TEXT, excerpt TEXT,
        dwell_time_sec INTEGER,
        source TEXT NOT NULL DEFAULT 'browser',
        status TEXT NOT NULL DEFAULT 'pending',
        tags TEXT, metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        classified_at TEXT, dreaming_run_id TEXT
      )
    `);
    app = createTestServer(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = TEST_DB_PATH + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it("POST /api/events — valid event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: {
        event_type: "page_visit",
        url: "https://example.com",
        title: "Test Page",
        excerpt: "Some content",
        dwell_time_sec: 120,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.status).toBe("pending");
  });

  it("POST /api/events — invalid event_type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { event_type: "invalid_type" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/events/batch — multiple events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events/batch",
      payload: {
        events: [
          { event_type: "page_visit", url: "https://a.com", title: "A" },
          { event_type: "page_visit", url: "https://b.com", title: "B" },
          { event_type: "tab_switch", title: "Switch" },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.inserted).toBe(3);
    expect(body.ids).toHaveLength(3);
  });

  it("POST /api/events/batch — empty array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events/batch",
      payload: { events: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("GET /api/status — returns count", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.daemon).toBe("running");
    expect(body.events_total).toBeGreaterThanOrEqual(4); // from previous tests
  });
});
