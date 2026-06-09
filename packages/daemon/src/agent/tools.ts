import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { readUserMd } from "../dreaming/updater.js";
import {
  getRecentEventsForAgent,
  getTodayStats,
  type EventRow,
  type EventStatus,
  type EventType,
  type TodayStats,
} from "../db/events.js";
import { searchMemories, type PersonaMemory } from "../memory/mem0.js";
import type { PersonaConfig } from "../config.js";

const eventStatusSchema = z.enum(["pending", "classified", "archived"]);
const eventTypeSchema = z.enum([
  "page_visit",
  "tab_switch",
  "chat_message",
  "context_switch",
]);

export interface PersonaToolDeps {
  readUserMd?: () => string;
  searchMemories?: (
    query: string,
    config: PersonaConfig,
    topK: number
  ) => Promise<PersonaMemory[]>;
  getRecentEvents?: (query: {
    limit?: number;
    status?: EventStatus;
    type?: EventType;
  }) => EventRow[];
  getTodayStats?: () => TodayStats;
}

function summarizeEvent(event: EventRow) {
  return {
    id: event.id,
    eventType: event.event_type,
    title: event.title,
    url: event.url,
    excerpt: event.excerpt,
    dwellTimeSec: event.dwell_time_sec,
    source: event.source,
    status: event.status,
    tags: event.tags ? (JSON.parse(event.tags) as string[]) : [],
    createdAt: event.created_at,
  };
}

export function createPersonaTools(config: PersonaConfig, deps: PersonaToolDeps = {}) {
  const readProfile = deps.readUserMd ?? readUserMd;
  const search = deps.searchMemories ?? searchMemories;
  const recentEvents = deps.getRecentEvents ?? getRecentEventsForAgent;
  const stats = deps.getTodayStats ?? getTodayStats;

  const profileTool = createTool({
    id: "persona_get_profile",
    description: "Read the user's current USER.md persona profile.",
    inputSchema: z.object({}).default({}),
    outputSchema: z.object({
      content: z.string(),
    }),
    mcp: {
      annotations: {
        title: "Get Persona Profile",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async () => {
      return { content: readProfile() };
    },
  });

  const searchMemoriesTool = createTool({
    id: "persona_search_memories",
    description:
      "Search durable local memories about the user's work, preferences, routines, goals, and behavioral patterns.",
    inputSchema: z.object({
      query: z.string().min(1),
      topK: z.number().int().min(1).max(10).optional(),
    }),
    outputSchema: z.object({
      memories: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          content: z.string(),
          score: z.number().optional(),
        })
      ),
      error: z.string().optional(),
    }),
    mcp: {
      annotations: {
        title: "Search Persona Memories",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async (inputData) => {
      try {
        const memories = await search(inputData.query, config, inputData.topK ?? 5);
        return {
          memories: memories.map((memory) => ({
            id: memory.id,
            path: memory.path,
            content: memory.content,
            score: memory.score,
          })),
        };
      } catch (err) {
        return {
          memories: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const recentEventsTool = createTool({
    id: "persona_get_recent_events",
    description:
      "Read recent local activity events captured by DigitalME, optionally filtered by status or event type.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      status: eventStatusSchema.optional(),
      type: eventTypeSchema.optional(),
    }),
    outputSchema: z.object({
      events: z.array(
        z.object({
          id: z.number(),
          eventType: z.string(),
          title: z.string().nullable(),
          url: z.string().nullable(),
          excerpt: z.string().nullable(),
          dwellTimeSec: z.number().nullable(),
          source: z.string(),
          status: z.string(),
          tags: z.array(z.string()),
          createdAt: z.string(),
        })
      ),
    }),
    mcp: {
      annotations: {
        title: "Get Recent Events",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async (inputData) => {
      return {
        events: recentEvents({
          limit: inputData.limit,
          status: inputData.status,
          type: inputData.type,
        }).map(summarizeEvent),
      };
    },
  });

  const statusTool = createTool({
    id: "persona_get_status",
    description: "Read today's local DigitalME daemon and activity status summary.",
    inputSchema: z.object({}).default({}),
    outputSchema: z.object({
      eventsToday: z.number(),
      eventsPending: z.number(),
      deepReadsToday: z.number(),
      contextSwitchesToday: z.number(),
      browseTimeTodaySec: z.number(),
      chatMessagesToday: z.number(),
    }),
    mcp: {
      annotations: {
        title: "Get Persona Status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async () => {
      const today = stats();
      return {
        eventsToday: today.total_events,
        eventsPending: today.pending_count,
        deepReadsToday: today.deep_reads,
        contextSwitchesToday: today.context_switches,
        browseTimeTodaySec: today.total_browse_sec,
        chatMessagesToday: today.chat_messages,
      };
    },
  });

  return {
    persona_get_profile: profileTool,
    persona_search_memories: searchMemoriesTool,
    persona_get_recent_events: recentEventsTool,
    persona_get_status: statusTool,
  };
}
