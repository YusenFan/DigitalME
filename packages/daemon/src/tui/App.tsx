/**
 * tui/App.tsx — Ink TUI 根组件
 *
 * 整合事件流和统计面板，组成完整的终端界面。
 * 布局：
 *   ┌─ Header ───────────────────┐
 *   │ Persona Engine v0.1.0      │
 *   ├─ EventFeed ────────────────┤
 *   │ [14:32] example.com  3m    │
 *   │ [14:35] docs.rs      5m 🔖│
 *   ├─ Summary ──────────────────┤
 *   │ Events: 47 · Deep reads: 8 │
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
export function App({ events, stats, serverAddress }: AppProps) {
  const { exit } = useApp();

  // 键盘快捷键处理 — 只在交互式终端下启用
  // 后台模式没有 TTY，useInput 会因为无法启用 raw mode 而报错
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
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

      {/* ── 底部快捷键提示 ─────────────────────── */}
      <Box paddingX={1} gap={2}>
        <Text dimColor>[q] quit</Text>
        <Text dimColor>[d] dream</Text>
        <Text dimColor>[s] status</Text>
      </Box>
    </Box>
  );
}
