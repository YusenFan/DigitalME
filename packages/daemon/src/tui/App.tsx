/**
 * tui/App.tsx — Ink TUI 根组件
 *
 * 整合事件流、统计面板和 dreaming 状态，组成完整的终端界面。
 * 布局：
 *   ┌─ Header ───────────────────┐
 *   │ Persona Engine v0.1.0      │
 *   ├─ EventFeed ────────────────┤
 *   │ [14:32] example.com  3m    │
 *   │ [14:35] docs.rs      5m 🔖│
 *   ├─ Summary ──────────────────┤
 *   │ Events: 47 · Deep reads: 8 │
 *   ├─ Dreaming ─────────────────┤
 *   │ 🧠 Classifying 47 events...│
 *   ├─ Footer ───────────────────┤
 *   │ [q] quit · [d] dream       │
 *   └───────────────────────────┘
 */

import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import { EventFeed } from "./EventFeed.js";
import { Summary } from "./Summary.js";
import type { EventRow, TodayStats } from "../db/events.js";

/** App 组件的 props */
interface AppProps {
  /** 最近的事件列表（按时间倒序） */
  events: EventRow[];
  /** 今日统计数据 */
  stats: TodayStats;
  /** HTTP 服务器监听地址（显示在 header） */
  serverAddress: string;
  /** Dreaming 日志消息 */
  dreamingLog?: string[];
  /** 是否正在 dreaming */
  isDreaming?: boolean;
  /** 手动触发 dreaming 回调 */
  onDream?: () => void;
}

/**
 * 检测当前 stdin 是否支持 raw mode（交互式终端）。
 * 后台运行或管道模式下 stdin 不是 TTY，Ink 的 useInput 会报错。
 */
const isInteractive = process.stdin.isTTY === true;

/**
 * TUI 根组件。
 * 使用 Ink 的 Box 做 flexbox 布局，竖向排列三个区域。
 */
export function App({
  events,
  stats,
  serverAddress,
  dreamingLog = [],
  isDreaming = false,
  onDream,
}: AppProps) {
  const { exit } = useApp();

  // 键盘快捷键处理 — 只在交互式终端下启用
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
      }
      if (input === "d" && onDream) {
        onDream();
      }
    },
    { isActive: isInteractive }
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* ── Header ─────────────────────────────── */}
      <Box borderStyle="single" paddingX={1}>
        <Text bold color="cyan">
          Persona Engine v0.1.0
        </Text>
        <Text> · daemon running · </Text>
        <Text dimColor>{serverAddress}</Text>
      </Box>

      {/* ── 事件流 ─────────────────────────────── */}
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        minHeight={10}
      >
        <Text bold underline>
          Event Feed
        </Text>
        <EventFeed events={events} />
      </Box>

      {/* ── 今日统计 ───────────────────────────── */}
      <Box borderStyle="single" paddingX={1}>
        <Summary stats={stats} />
      </Box>

      {/* ── Dreaming 状态 ─────────────────────── */}
      {dreamingLog.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={isDreaming ? "yellow" : "green"}
          paddingX={1}
        >
          <Text bold color={isDreaming ? "yellow" : "green"}>
            {isDreaming ? "🧠 Dreaming..." : "🧠 Dreaming"}
          </Text>
          {dreamingLog.slice(-5).map((msg, i) => (
            <Text key={i} dimColor={!isDreaming}>
              {msg}
            </Text>
          ))}
        </Box>
      )}

      {/* ── 底部快捷键提示 ─────────────────────── */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>[q] quit</Text>
        <Text dimColor>[d] dream{isDreaming ? " (running...)" : ""}</Text>
        <Text dimColor>[c] chat at http://127.0.0.1:19000/chat</Text>
      </Box>
    </Box>
  );
}
