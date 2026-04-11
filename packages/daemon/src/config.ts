/**
 * config.ts — 配置管理模块
 *
 * 负责读取、写入和合并 ~/.persona-engine/config.json。
 * 配置文件不存在时自动创建默认配置。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── 类型定义 ────────────────────────────────────────────

/** Daemon 运行时配置（HTTP 服务器绑定地址和端口） */
interface DaemonConfig {
  port: number;
  host: string;
}

/** LLM API 配置（provider + model + key） */
interface LlmConfig {
  provider: string;
  model: string;
  apiKey: string;
}

/** Dreaming 模块配置（定时任务、衰减半衰期、token 预算） */
interface DreamingConfig {
  schedule: string; // cron 表达式
  decayHalfLifeDays: number;
  userMdTokenBudget: number;
}

/** 浏览器采集配置 */
interface BrowserCollectionConfig {
  enabled: boolean;
  blocklist: string[]; // 不采集的域名列表
  allowlist: string[]; // 只采集的域名列表（空 = 全部）
  excerptMaxChars: number;
}

/** 数据采集配置 */
interface CollectionConfig {
  browser: BrowserCollectionConfig;
  directories: string[]; // 要扫描的目录
}

/** Embedding 向量模型配置 */
interface EmbeddingConfig {
  provider: string;
  model: string;
}

/** 事件存储配置 */
interface EventsConfig {
  retentionDays: number; // 事件保留天数，超过自动归档
}

/** 完整的配置文件结构 */
export interface PersonaConfig {
  daemon: DaemonConfig;
  llm: LlmConfig;
  dreaming: DreamingConfig;
  collection: CollectionConfig;
  embedding: EmbeddingConfig;
  events: EventsConfig;
}

// ── 默认值 ──────────────────────────────────────────────

/** 数据目录路径：~/.persona-engine/ */
export const DATA_DIR = path.join(os.homedir(), ".persona-engine");

/** 配置文件路径 */
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

/** PID 文件路径 — daemon 运行时写入进程 ID */
export const PID_FILE = path.join(DATA_DIR, "daemon.pid");

/** events.sqlite 数据库路径 */
export const DB_PATH = path.join(DATA_DIR, "events.sqlite");

/** 默认配置 — 所有字段都有合理的初始值 */
const DEFAULT_CONFIG: PersonaConfig = {
  daemon: {
    port: 19000,
    host: "127.0.0.1", // 只监听本地，不暴露到网络
  },
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "", // 用户需要自己填
  },
  dreaming: {
    schedule: "0 23 * * *", // 每晚 23:00
    decayHalfLifeDays: 30,
    userMdTokenBudget: 3000,
  },
  collection: {
    browser: {
      enabled: true,
      blocklist: [], // 用户可以添加敏感域名
      allowlist: [],
      excerptMaxChars: 1000,
    },
    directories: [],
  },
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
  },
  events: {
    retentionDays: 90,
  },
};

// ── 公开 API ────────────────────────────────────────────

/**
 * 确保数据目录 ~/.persona-engine/ 存在。
 * 如果不存在就递归创建。
 */
export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 加载配置文件。
 *
 * 逻辑：
 * 1. 如果 config.json 不存在 → 创建默认配置并返回
 * 2. 如果存在 → 读取并与默认值深度合并（用户只需写想改的字段）
 */
export function loadConfig(): PersonaConfig {
  ensureDataDir();

  if (!fs.existsSync(CONFIG_PATH)) {
    // 首次运行，写入默认配置
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  // 读取用户配置，与默认值合并（用户的值优先）
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const userConfig = JSON.parse(raw) as Partial<PersonaConfig>;
  return deepMerge(DEFAULT_CONFIG, userConfig) as PersonaConfig;
}

/**
 * 将配置写入 config.json（格式化为可读 JSON）
 */
export function saveConfig(config: PersonaConfig): void {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600, // 权限 600：只有文件所有者可读写（保护 API key）
  });
}

// ── 内部工具函数 ────────────────────────────────────────

/**
 * 深度合并两个对象。source 的值覆盖 target 的值。
 * 只处理 plain object，数组直接覆盖（不合并数组元素）。
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    // 两边都是 plain object → 递归合并
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      // 其它情况（数组、字符串、数字等）→ source 直接覆盖 target
      result[key] = sourceVal;
    }
  }

  return result;
}

/** 判断是否为 plain object（不是数组、null、Date 等） */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
