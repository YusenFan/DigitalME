import {
  streamAgentReply,
  type AgentMessage as ChatMessage,
  type AgentStreamCallbacks as StreamCallbacks,
} from "../agent/session.js";
import type { PersonaConfig } from "../config.js";

export type { ChatMessage, StreamCallbacks };

export async function chat(
  message: string,
  history: ChatMessage[],
  config: PersonaConfig,
  callbacks: StreamCallbacks
): Promise<string> {
  return streamAgentReply(message, history, config, callbacks);
}
