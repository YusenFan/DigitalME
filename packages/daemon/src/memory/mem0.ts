import path from "node:path";
import type { Memory as Mem0Memory, MemoryConfig, MemoryItem } from "mem0ai/oss";
import { DATA_DIR, ensureDataDir, type PersonaConfig } from "../config.js";
import type { MemoryUpdate } from "../dreaming/inferrer.js";

process.env.MEM0_TELEMETRY ??= "false";

const USER_ID = "persona-engine-user";
const COLLECTION_NAME = "persona-engine-memories";
const VECTOR_DB_PATH = path.join(DATA_DIR, "mem0-vectors.db");
const HISTORY_DB_PATH = path.join(DATA_DIR, "mem0-history.db");

export interface PersonaMemory {
  id: string;
  content: string;
  path: string;
  score?: number;
  createdAt?: string;
  updatedAt?: string;
  metadata: Record<string, unknown>;
}

function embeddingDimension(model: string): number | undefined {
  if (model === "text-embedding-3-large") return 3072;
  if (model === "text-embedding-3-small" || model === "text-embedding-ada-002") {
    return 1536;
  }
  return undefined;
}

async function createMemory(config: PersonaConfig): Promise<Mem0Memory> {
  ensureDataDir();
  const { Memory } = await import("mem0ai/oss");

  const dimension = embeddingDimension(config.embedding.model);
  const vectorConfig: MemoryConfig["vectorStore"]["config"] = {
    collectionName: COLLECTION_NAME,
    dbPath: VECTOR_DB_PATH,
  };
  if (dimension) {
    vectorConfig.dimension = dimension;
  }

  return new Memory({
    version: "v1.1",
    embedder: {
      provider: config.embedding.provider,
      config: {
        apiKey: config.llm.apiKey,
        model: config.embedding.model,
      },
    },
    vectorStore: {
      provider: "memory",
      config: vectorConfig,
    },
    llm: {
      provider: config.llm.provider,
      config: {
        apiKey: config.llm.apiKey,
        model: config.llm.model,
      },
    },
    historyStore: {
      provider: "sqlite",
      config: {
        historyDbPath: HISTORY_DB_PATH,
      },
    },
    customInstructions:
      "Extract durable memories about the user's work, preferences, routines, goals, and recurring behavioral patterns. Ignore one-off noise.",
  });
}

function toPersonaMemory(item: MemoryItem): PersonaMemory {
  const metadata = item.metadata ?? {};
  const pathValue = metadata.path;
  const fallbackPath = `mem0/${item.id}`;

  return {
    id: item.id,
    content: item.memory,
    path: typeof pathValue === "string" ? pathValue : fallbackPath,
    score: item.score,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    metadata,
  };
}

function formatMemoryUpdate(update: MemoryUpdate): string {
  return [
    `Memory path: ${update.path}`,
    `Action: ${update.action}`,
    `Tags: ${update.tags.join(", ") || "(none)"}`,
    `Source event IDs: ${update.source_events.join(", ") || "(none)"}`,
    "",
    update.content_summary,
  ].join("\n");
}

export async function addMemoryUpdates(
  memoryUpdates: MemoryUpdate[],
  config: PersonaConfig
): Promise<string[]> {
  const memory = await createMemory(config);
  const updatedPaths: string[] = [];

  for (const update of memoryUpdates) {
    await memory.add(formatMemoryUpdate(update), {
      userId: USER_ID,
      infer: true,
      metadata: {
        path: update.path,
        action: update.action,
        tags: update.tags,
        sourceEvents: update.source_events,
      },
    });
    updatedPaths.push(update.path);
  }

  return updatedPaths;
}

export async function searchMemories(
  query: string,
  config: PersonaConfig,
  topK: number
): Promise<PersonaMemory[]> {
  const memory = await createMemory(config);
  const result = await memory.search(query, {
    topK,
    threshold: 0.1,
    filters: {
      user_id: USER_ID,
    },
  });

  return result.results.map(toPersonaMemory);
}

export async function listMemories(
  config: PersonaConfig,
  topK = 100
): Promise<PersonaMemory[]> {
  const memory = await createMemory(config);
  const result = await memory.getAll({
    topK,
    filters: {
      user_id: USER_ID,
    },
  });

  return result.results.map(toPersonaMemory);
}
