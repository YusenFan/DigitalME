/**
 * config.test.ts — 配置管理模块测试
 *
 * 测试配置的加载、保存、验证和合并逻辑。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 为测试创建临时数据目录，不污染真实数据
const TEST_DIR = path.join(os.tmpdir(), `persona-test-${Date.now()}`);

// 需要在 import config 之前 mock DATA_DIR
// 由于 config.ts 用 import.meta.dirname 计算路径，我们直接测试验证函数

describe("validateConfig", () => {
  // 动态导入以获取 validateConfig
  let validateConfig: typeof import("../packages/daemon/src/config.js").validateConfig;

  beforeEach(async () => {
    const mod = await import("../packages/daemon/src/config.js");
    validateConfig = mod.validateConfig;
  });

  it("should pass with valid default config", () => {
    const config = {
      daemon: { port: 19000, host: "127.0.0.1" },
      llm: { provider: "openai", model: "gpt-5.4", apiKey: "sk-test" },
      dreaming: { schedule: "0 23 * * *", decayHalfLifeDays: 30, userMdTokenBudget: 3000 },
      collection: {
        browser: { enabled: true, blocklist: [], allowlist: [], excerptMaxChars: 1000 },
        directories: [],
      },
      embedding: { provider: "openai", model: "text-embedding-3-small" },
      events: { retentionDays: 90 },
    };
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  it("should reject invalid port", () => {
    const config = {
      daemon: { port: 99999, host: "127.0.0.1" },
      llm: { provider: "openai", model: "gpt-5.4", apiKey: "" },
      dreaming: { schedule: "0 23 * * *", decayHalfLifeDays: 30, userMdTokenBudget: 3000 },
      collection: {
        browser: { enabled: true, blocklist: [], allowlist: [], excerptMaxChars: 1000 },
        directories: [],
      },
      embedding: { provider: "openai", model: "text-embedding-3-small" },
      events: { retentionDays: 90 },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("port"))).toBe(true);
  });

  it("should reject missing provider", () => {
    const config = {
      daemon: { port: 19000, host: "127.0.0.1" },
      llm: { provider: "", model: "gpt-5.4", apiKey: "" },
      dreaming: { schedule: "0 23 * * *", decayHalfLifeDays: 30, userMdTokenBudget: 3000 },
      collection: {
        browser: { enabled: true, blocklist: [], allowlist: [], excerptMaxChars: 1000 },
        directories: [],
      },
      embedding: { provider: "openai", model: "text-embedding-3-small" },
      events: { retentionDays: 90 },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("provider"))).toBe(true);
  });

  it("should reject too-small token budget", () => {
    const config = {
      daemon: { port: 19000, host: "127.0.0.1" },
      llm: { provider: "openai", model: "gpt-5.4", apiKey: "" },
      dreaming: { schedule: "0 23 * * *", decayHalfLifeDays: 30, userMdTokenBudget: 100 },
      collection: {
        browser: { enabled: true, blocklist: [], allowlist: [], excerptMaxChars: 1000 },
        directories: [],
      },
      embedding: { provider: "openai", model: "text-embedding-3-small" },
      events: { retentionDays: 90 },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("userMdTokenBudget"))).toBe(true);
  });
});
