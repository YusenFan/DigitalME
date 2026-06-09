import { describe, it, expect } from "vitest";
import { createPersonaTools } from "../packages/daemon/src/agent/tools.js";
import type { PersonaConfig } from "../packages/daemon/src/config.js";
import type { EventRow } from "../packages/daemon/src/db/events.js";

const testConfig: PersonaConfig = {
  daemon: { host: "127.0.0.1", port: 19000 },
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

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    event_type: "page_visit",
    url: "https://example.com",
    title: "Example",
    excerpt: "Example content",
    dwell_time_sec: 120,
    source: "browser",
    status: "classified",
    tags: JSON.stringify(["research"]),
    metadata: null,
    created_at: "2026-06-09 12:00:00",
    classified_at: null,
    dreaming_run_id: null,
    ...overrides,
  };
}

describe("Persona agent tools", () => {
  it("persona_get_profile returns USER.md content", async () => {
    const tools = createPersonaTools(testConfig, {
      readUserMd: () => "# USER\nLocal profile",
    });

    const result = await tools.persona_get_profile.execute?.({});
    expect(result).toEqual({ content: "# USER\nLocal profile" });
  });

  it("persona_search_memories returns an empty result on search failure", async () => {
    const tools = createPersonaTools(testConfig, {
      searchMemories: async () => {
        throw new Error("embedding unavailable");
      },
    });

    const result = await tools.persona_search_memories.execute?.({
      query: "what am I working on?",
    });

    expect(result).toEqual({
      memories: [],
      error: "embedding unavailable",
    });
  });

  it("persona_get_recent_events returns bounded event summaries", async () => {
    const tools = createPersonaTools(testConfig, {
      getRecentEvents: (query) => [makeEvent({ id: query.limit ?? 0 })],
    });

    const result = await tools.persona_get_recent_events.execute?.({
      limit: 3,
      status: "classified",
      type: "page_visit",
    });

    expect(result?.events).toHaveLength(1);
    expect(result?.events[0]).toMatchObject({
      id: 3,
      eventType: "page_visit",
      title: "Example",
      tags: ["research"],
    });
  });

  it("persona_get_status returns today's local summary", async () => {
    const tools = createPersonaTools(testConfig, {
      getTodayStats: () => ({
        total_events: 10,
        pending_count: 2,
        deep_reads: 1,
        context_switches: 3,
        total_browse_sec: 400,
        chat_messages: 4,
      }),
    });

    const result = await tools.persona_get_status.execute?.({});
    expect(result).toEqual({
      eventsToday: 10,
      eventsPending: 2,
      deepReadsToday: 1,
      contextSwitchesToday: 3,
      browseTimeTodaySec: 400,
      chatMessagesToday: 4,
    });
  });
});
