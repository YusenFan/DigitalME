/**
 * dreaming/decay.ts — 时间衰减机制
 *
 * mem0 接管长期记忆管理后，旧的 markdown decay 机制保留为兼容层。
 * Dreaming 报告仍然可以携带 decayResults，但这里不再修改记忆内容。
 */

/** 衰减结果 */
export interface DecayResult {
  file: string;
  oldWeight: number;
  newWeight: number;
  daysSinceUpdate: number;
}

/**
 * mem0 自己管理 memory 写入、合并和检索，这里不再做额外衰减。
 *
 * @param halfLifeDays  半衰期天数（默认 30）
 * @returns 被衰减的文件列表及其权重变化
 */
export function applyDecay(halfLifeDays: number): DecayResult[] {
  void halfLifeDays;
  return [];
}

/**
 * mem0 不暴露旧 markdown decay weight，压缩器不再收到 stale 文件列表。
 */
export function getStaleMemories(): string[] {
  return [];
}
