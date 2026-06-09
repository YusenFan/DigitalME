import { Agent } from "@mastra/core/agent";
import { readUserMd } from "../dreaming/updater.js";
import type { PersonaConfig } from "../config.js";
import { createPersonaTools } from "./tools.js";

function modelId(config: PersonaConfig): string {
  if (config.llm.provider !== "openai") {
    throw new Error(
      `Unsupported Mastra agent provider: "${config.llm.provider}". Currently supported: openai`
    );
  }
  return `${config.llm.provider}/${config.llm.model}`;
}

function ensureProviderEnv(config: PersonaConfig): void {
  if (config.llm.provider === "openai" && config.llm.apiKey) {
    process.env.OPENAI_API_KEY = config.llm.apiKey;
  }
}

function buildInstructions(): string {
  const userMd = readUserMd();
  const parts = [
    `You are DigitalME's local-first persona-aware assistant.
Use the local tools when the user asks about their profile, memories, recent activity, or status.
All tools are read-only. Do not claim to have changed local data.
Use the profile and memories to answer with concrete, personalized context when relevant.
If a local search tool fails or returns nothing, say what you can answer from the available profile and conversation.`,
  ];

  if (userMd) {
    parts.push(`## Current USER.md\n${userMd}`);
  }

  return parts.join("\n\n");
}

export function createPersonaAgent(config: PersonaConfig) {
  ensureProviderEnv(config);

  return new Agent({
    id: "digitalme-persona-agent",
    name: "DigitalME Persona Agent",
    description:
      "A local-first persona-aware agent with read-only tools for profile, memories, events, and status.",
    instructions: buildInstructions(),
    model: modelId(config),
    tools: createPersonaTools(config),
  });
}
