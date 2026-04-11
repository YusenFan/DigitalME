/**
 * tui/Summary.tsx — 今日统计面板组件
 *
 * 显示今天的汇总数据：事件数、深度阅读、上下文切换、浏览时间、聊天消息、待处理数。
 * 所有数据来自 getTodayStats() 的查询结果。
 */

import React from "react";
import { Box, Text } from "ink";
import type { TodayStats } from "../db/events.js";

/** Summary 组件的 props */
interface SummaryProps {
  stats: TodayStats;
}

/**
 * 将秒数格式化为 "Xh Ym" 形式。
 * 例：7440 → "2h 04m"，180 → "0h 03m"
 */
function formatHoursMinutes(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/**
 * 今日统计面板。
 * 水平排列各项指标，用分隔符分开。
 */
export function Summary({ stats }: SummaryProps) {
  return (
    <Box gap={1} flexWrap="wrap">
      <Text bold>Today</Text>
      <Text dimColor>|</Text>

      <Text>
        Events: <Text color="cyan">{stats.total_events}</Text>
      </Text>
      <Text dimColor>·</Text>

      <Text>
        Deep reads: <Text color="green">{stats.deep_reads}</Text>
      </Text>
      <Text dimColor>·</Text>

      <Text>
        Switches: <Text color="yellow">{stats.context_switches}</Text>
      </Text>
      <Text dimColor>·</Text>

      <Text>
        Browse: <Text color="cyan">{formatHoursMinutes(stats.total_browse_sec)}</Text>
      </Text>
      <Text dimColor>·</Text>

      <Text>
        Chat: <Text>{stats.chat_messages}</Text>
      </Text>
      <Text dimColor>·</Text>

      <Text>
        Pending: <Text color="magenta">{stats.pending_count}</Text>
      </Text>
    </Box>
  );
}
