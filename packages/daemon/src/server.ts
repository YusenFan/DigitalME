/**
 * server.ts — Fastify HTTP API 服务器
 *
 * 端点：
 *   POST /api/events       — 接收单个浏览器事件
 *   POST /api/events/batch — 批量接收事件
 *   GET  /api/status       — daemon 健康状态 + 统计摘要
 *   GET  /api/user         — 返回 USER.md 内容
 *   POST /api/chat         — 流式聊天（SSE）
 *   GET  /chat             — Web 聊天 UI
 *
 * 绑定 127.0.0.1 only（不暴露到网络），CORS 限制为 Chrome extension + localhost。
 */

import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { type PersonaConfig } from "./config.js";
import {
  insertEvent,
  insertEventBatch,
  getTodayStats,
  getEventsByStatus,
  type InsertEventInput,
  type EventType,
} from "./db/events.js";
import { readUserMd } from "./dreaming/updater.js";
import { chat, type ChatMessage } from "./chat/session.js";

// ── 类型定义 ────────────────────────────────────────────

/** POST /api/events 请求体 */
interface PostEventBody {
  event_type: EventType;
  url?: string;
  title?: string;
  excerpt?: string;
  dwell_time_sec?: number;
  timestamp?: string; // 客户端时间戳（目前记录但不使用，created_at 由数据库生成）
}

/** POST /api/events/batch 请求体 */
interface PostEventBatchBody {
  events: PostEventBody[];
}

/** POST /api/chat 请求体 */
interface PostChatBody {
  message: string;
  history?: ChatMessage[];
}

// ── 事件回调 ────────────────────────────────────────────

/** 新事件插入后的回调类型 — 用于通知 TUI 刷新 */
export type OnEventInserted = (eventIds: number[]) => void;

// ── 服务器创建 ──────────────────────────────────────────

/** daemon 启动时间，用于 /api/status 计算 uptime */
const startedAt = Date.now();

/**
 * 创建并配置 Fastify 服务器实例。
 *
 * @param config          - 完整配置（取 daemon.port, daemon.host）
 * @param onEventInserted - 可选回调，新事件插入后触发（通知 TUI 刷新）
 * @returns 配置好的 Fastify 实例（还未 listen）
 */
export async function createServer(
  config: PersonaConfig,
  onEventInserted?: OnEventInserted
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // TUI 模式下不需要 Fastify 自带日志
  });

  // ── CORS 配置 ──────────────────────────────────
  // 只允许 Chrome extension 的 origin（chrome-extension://xxx）
  // 和本地开发（localhost）访问
  await app.register(cors, {
    origin: (origin, cb) => {
      // 无 origin（如 curl 或同源请求）→ 允许
      if (!origin) return cb(null, true);
      // Chrome extension origin 格式：chrome-extension://<id>
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      // 本地开发 → 允许
      if (origin.includes("localhost") || origin.includes("127.0.0.1"))
        return cb(null, true);
      // 其它来源 → 拒绝
      cb(new Error("CORS: Origin not allowed"), false);
    },
  });

  // ── POST /api/events — 接收单个事件 ────────────
  app.post<{ Body: PostEventBody }>("/api/events", async (request, reply) => {
    const body = request.body;

    // 基本校验：event_type 必须是合法值
    const validTypes: EventType[] = [
      "page_visit",
      "tab_switch",
      "chat_message",
      "context_switch",
    ];
    if (!body.event_type || !validTypes.includes(body.event_type)) {
      return reply.status(400).send({
        error: `Invalid event_type. Must be one of: ${validTypes.join(", ")}`,
      });
    }

    // 构造存储输入
    const input: InsertEventInput = {
      event_type: body.event_type,
      url: body.url,
      title: body.title,
      excerpt: body.excerpt,
      dwell_time_sec: body.dwell_time_sec,
    };

    const id = insertEvent(input);

    // 通知 TUI 有新事件
    onEventInserted?.([id]);

    return reply.status(201).send({ id, status: "pending" });
  });

  // ── POST /api/events/batch — 批量接收事件 ──────
  app.post<{ Body: PostEventBatchBody }>(
    "/api/events/batch",
    async (request, reply) => {
      const { events } = request.body;

      if (!Array.isArray(events) || events.length === 0) {
        return reply
          .status(400)
          .send({ error: "Request body must contain a non-empty 'events' array" });
      }

      // 转换为存储输入格式
      const inputs: InsertEventInput[] = events.map((e) => ({
        event_type: e.event_type,
        url: e.url,
        title: e.title,
        excerpt: e.excerpt,
        dwell_time_sec: e.dwell_time_sec,
      }));

      const ids = insertEventBatch(inputs);

      // 通知 TUI
      onEventInserted?.(ids);

      return reply.status(201).send({ inserted: ids.length, ids });
    }
  );

  // ── GET /api/status — 健康状态 + 统计 ─────────
  app.get("/api/status", async (_request, reply) => {
    const stats = getTodayStats();
    const pending = getEventsByStatus("pending", 0); // count only

    return reply.send({
      daemon: "running",
      uptime_sec: Math.floor((Date.now() - startedAt) / 1000),
      port: config.daemon.port,
      events_today: stats.total_events,
      events_pending: stats.pending_count,
      deep_reads_today: stats.deep_reads,
      context_switches_today: stats.context_switches,
      browse_time_today_sec: stats.total_browse_sec,
      chat_messages_today: stats.chat_messages,
    });
  });

  // ── GET /api/user — 返回 USER.md 内容 ────────
  app.get("/api/user", async (_request, reply) => {
    const content = readUserMd();
    return reply.send({ content });
  });

  // ── POST /api/chat — 流式聊天（SSE） ─────────
  app.post<{ Body: PostChatBody }>("/api/chat", async (request, reply) => {
    const { message, history = [] } = request.body;

    if (!message || typeof message !== "string") {
      return reply.status(400).send({ error: "message is required" });
    }

    // SSE 响应头
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await chat(message, history, config, {
      onToken(token) {
        const data = JSON.stringify({ type: "token", content: token });
        reply.raw.write(`data: ${data}\n\n`);
      },
      onDone(fullText) {
        const data = JSON.stringify({ type: "done", content: fullText });
        reply.raw.write(`data: ${data}\n\n`);
        reply.raw.end();
      },
      onError(error) {
        const data = JSON.stringify({ type: "error", content: error.message });
        reply.raw.write(`data: ${data}\n\n`);
        reply.raw.end();
      },
    });
  });

  // ── GET /chat — Web 聊天 UI ──────────────────
  // 提供静态 HTML 文件作为简易聊天界面
  const WEB_UI_DIR = path.resolve(import.meta.dirname, "../../web-ui");

  app.get("/chat", async (_request, reply) => {
    const htmlPath = path.join(WEB_UI_DIR, "index.html");
    if (!fs.existsSync(htmlPath)) {
      return reply.status(404).send({ error: "Web UI not found" });
    }
    const html = fs.readFileSync(htmlPath, "utf-8");
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  app.get("/chat/style.css", async (_request, reply) => {
    const cssPath = path.join(WEB_UI_DIR, "style.css");
    if (!fs.existsSync(cssPath)) {
      return reply.status(404).send("");
    }
    const css = fs.readFileSync(cssPath, "utf-8");
    reply.header("Content-Type", "text/css; charset=utf-8");
    return reply.send(css);
  });

  app.get("/chat/chat.js", async (_request, reply) => {
    const jsPath = path.join(WEB_UI_DIR, "chat.js");
    if (!fs.existsSync(jsPath)) {
      return reply.status(404).send("");
    }
    const js = fs.readFileSync(jsPath, "utf-8");
    reply.header("Content-Type", "application/javascript; charset=utf-8");
    return reply.send(js);
  });

  return app;
}

/**
 * 启动 HTTP 服务器，开始监听。
 *
 * @returns 实际监听的地址字符串（如 "http://127.0.0.1:19000"）
 */
export async function startServer(
  app: FastifyInstance,
  config: PersonaConfig
): Promise<string> {
  const address = await app.listen({
    port: config.daemon.port,
    host: config.daemon.host,
  });
  return address;
}
