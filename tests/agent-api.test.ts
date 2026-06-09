import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../packages/daemon/src/server.js";
import type { PersonaConfig } from "../packages/daemon/src/config.js";
import type { PersonaAgentRunner } from "../packages/daemon/src/agent/session.js";

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

describe("Agent API", () => {
  let app: FastifyInstance;
  const runner: PersonaAgentRunner = {
    async generate(messages) {
      const last = messages[messages.length - 1];
      return {
        text: `fake reply: ${last.content}`,
        toolCalls: [{ toolName: "persona_get_profile" }],
        toolResults: [{ content: "profile" }],
      };
    },
  };

  beforeAll(async () => {
    app = await createServer(testConfig, undefined, {
      agentRunner: runner,
      persistAgentMessages: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/agent/test returns a JSON reply", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/test",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "fake reply: hello" });
  });

  it("POST /api/agent/test can include debug tool data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/test",
      payload: { message: "profile?", includeDebug: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toBe("fake reply: profile?");
    expect(body.toolCalls).toEqual([{ toolName: "persona_get_profile" }]);
    expect(body.toolResults).toEqual([{ content: "profile" }]);
  });

  it("POST /api/agent/test rejects missing message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/test",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
