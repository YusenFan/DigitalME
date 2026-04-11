/**
 * tui/EventFeed.tsx — 实时事件流组件
 *
 * 显示最近的浏览器事件列表。每个事件展示：
 * - 时间戳 [HH:MM]
 * - 事件类型图标
 * - URL 的 domain + path（截断到合理长度）
 * - 停留时间
 * - 深度阅读 / 挂机标记
 *
 * ── 关于 deep read 的判定 ──
 * 这里只是 TUI 显示层的**初步标记**，基于 dwell_time 做简单判断：
 *   - dwell > 5min 且 < 45min → 标记为 "deep"（深度阅读）
 *   - dwell > 45min → 标记为 "idle?"（可能挂机）
 *
 * 真正的智能判定依赖：
 *   1. 浏览器扩展（Phase 3）— 通过 visibilitychange 只追踪活跃标签页，
 *      多开页面时非活跃的不计时。
 *   2. Dreaming 分类（Phase 4）— 基于内容判断页面是否有价值，
 *      日历、空白页等低价值页面会被标记。
 */

import React from "react";
import { Box, Text } from "ink";
import type { EventRow } from "../db/events.js";

/** 最多显示多少条事件（避免撑爆终端） */
const MAX_DISPLAY = 15;

/** 深度阅读最低阈值（秒）— 停留超过 5 分钟才可能是深度阅读 */
const DEEP_READ_MIN_SEC = 300;

/**
 * 挂机阈值（秒）— 单个页面停留超过 45 分钟，更可能是挂机而非阅读。
 * 浏览器扩展（Phase 3）会用 visibilitychange 追踪真实活跃时间，
 * 所以到时候 dwell_time 已经过滤掉了非活跃时间。
 * 这个阈值是 Phase 1 缺少扩展数据时的保守估计。
 */
const IDLE_THRESHOLD_SEC = 2700;

/** EventFeed 组件的 props */
interface EventFeedProps {
  events: EventRow[];
}

/**
 * 将完整 URL 缩短为 domain + path（去掉协议和查询参数）。
 * 例：https://docs.rs/tokio/latest/runtime?q=1 → docs.rs/tokio/latest/runtime
 */
function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return parsed.hostname + path;
  } catch {
    return url;
  }
}

/**
 * 将秒数格式化为人类可读的时长。
 * 例：180 → "3m 00s"，62 → "1m 02s"
 */
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * 从 ISO 时间字符串提取 HH:MM（本地时间）。
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * 根据事件类型返回对应的图标。
 */
function eventIcon(eventType: string): string {
  switch (eventType) {
    case "page_visit":
      return ">>";
    case "tab_switch":
      return "<>";
    case "chat_message":
      return "%%";
    case "context_switch":
      return "~~";
    default:
      return "  ";
  }
}

/**
 * 判断一个 page_visit 事件的阅读状态。
 *
 * @returns "deep" | "idle" | "normal"
 */
function readingStatus(
  dwellSec: number | null
): "deep" | "idle" | "normal" {
  if (dwellSec == null) return "normal";
  if (dwellSec > IDLE_THRESHOLD_SEC) return "idle";
  if (dwellSec > DEEP_READ_MIN_SEC) return "deep";
  return "normal";
}

/**
 * 事件流组件。显示最近的事件列表。
 * 没有事件时显示等待提示。
 */
export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <Text dimColor>
        Waiting for events... (use browser extension or curl to send events)
      </Text>
    );
  }

  // 只取最近 N 条，按时间正序显示（最新的在底部）
  const displayed = events.slice(0, MAX_DISPLAY).reverse();

  return (
    <Box flexDirection="column">
      {displayed.map((event) => {
        const status =
          event.event_type === "page_visit"
            ? readingStatus(event.dwell_time_sec)
            : "normal";

        return (
          <Box key={event.id} gap={1}>
            {/* 时间戳 */}
            <Text dimColor>[{formatTime(event.created_at)}]</Text>

            {/* 事件类型图标 */}
            <Text>{eventIcon(event.event_type)}</Text>

            {/* 内容 — URL 或标题 */}
            <Text>
              {event.url ? shortenUrl(event.url) : event.title ?? "unknown"}
            </Text>

            {/* 停留时间（如果有） */}
            {event.dwell_time_sec != null && (
              <Text color="yellow">{formatDuration(event.dwell_time_sec)}</Text>
            )}

            {/* 阅读状态标记 */}
            {status === "deep" && <Text color="green">deep</Text>}
            {status === "idle" && <Text color="red">idle?</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
