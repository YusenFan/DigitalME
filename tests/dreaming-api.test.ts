/**
 * dreaming-api.test.ts — POST /api/dreaming/run 端点测试
 *
 * 使用真实 createServer + 注入 fake DreamingControl（不跑真实 dreaming pipeline，
 * 模式与 agent-api.test.ts 的 fake runner 一致）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer, type DreamingControl } from "../packages/daemon/src/server.js";
import type { PersonaConfig } from "../packages/daemon/src/config.js";

const testConfig: PersonaConfig = {
  daemon: { host: "127.0.0.1", port: 0 },
  llm: { provider: "openai", model: "gpt-test", apiKey: "test-key" },
  dreaming: {
    schedule: "0 23 * * *",
    decayHalfLifeDays: 30,
    userMdTokenBudget: 3000,
  },
  collection: {
    browser: {
      enabled: true,
      blocklist: [],
      allowlist: [],
      excerptMaxChars: 1000,
    },
    directories: [],
  },
  embedding: { provider: "openai", model: "text-embedding-3-small" },
  events: { retentionDays: 90 },
};

describe("Dreaming API", () => {
  let app: FastifyInstance;
  let running = false;
  let runCalls = 0;

  const control: DreamingControl = {
    isRunning: () => running,
    run: () => {
      runCalls++;
      running = true; // 模拟 index.tsx 里 triggerDream 的同步上锁
    },
  };

  beforeAll(async () => {
    app = await createServer(testConfig, undefined, { dreaming: control });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/dreaming/run — 空闲时触发，返回 202", async () => {
    running = false;
    runCalls = 0;

    const res = await app.inject({ method: "POST", url: "/api/dreaming/run" });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: true });
    expect(runCalls).toBe(1);
  });

  it("POST /api/dreaming/run — 已在跑时返回 409，不重复触发", async () => {
    // 上一个测试已把 running 置 true
    const res = await app.inject({ method: "POST", url: "/api/dreaming/run" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already in progress/i);
    expect(runCalls).toBe(1); // run 没有被再次调用
  });
});

describe("Dreaming API — 未注入 DreamingControl", () => {
  it("POST /api/dreaming/run 返回 503", async () => {
    const app = await createServer(testConfig);
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/dreaming/run" });

    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
