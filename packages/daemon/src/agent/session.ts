import { insertEvent } from "../db/events.js";
import type { PersonaConfig } from "../config.js";
import { createPersonaAgent } from "./persona-agent.js";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentReply {
  reply: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

export interface AgentStreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface PersonaAgentRunner {
  generate: (
    messages: AgentMessage[],
    options?: { maxSteps?: number }
  ) => Promise<{
    text: string;
    toolCalls?: unknown[] | Promise<unknown[]>;
    toolResults?: unknown[] | Promise<unknown[]>;
  }>;
  stream?: (
    messages: AgentMessage[],
    options?: { maxSteps?: number }
  ) => Promise<{
    textStream: AsyncIterable<string> | ReadableStream<string>;
    toolCalls?: unknown[] | Promise<unknown[]>;
    toolResults?: unknown[] | Promise<unknown[]>;
  }>;
}

export interface AgentSessionOptions {
  runner?: PersonaAgentRunner;
  persistEvents?: boolean;
}

function buildMessages(message: string, history: AgentMessage[]): AgentMessage[] {
  return [...history, { role: "user", content: message }];
}

function persistChatMessage(role: "user" | "assistant", content: string): void {
  insertEvent({
    event_type: "chat_message",
    title: content.slice(0, 200),
    excerpt: role === "assistant" ? content.slice(0, 1000) : content,
    source: "chat",
    metadata: { role },
  });
}

function getRunner(
  config: PersonaConfig,
  options: AgentSessionOptions = {}
): PersonaAgentRunner {
  return options.runner ?? createPersonaAgent(config);
}

async function resolveMaybePromise<T>(value: T | Promise<T> | undefined): Promise<T | undefined> {
  return value instanceof Promise ? value : Promise.resolve(value);
}

export async function generateAgentReply(
  message: string,
  history: AgentMessage[],
  config: PersonaConfig,
  options: AgentSessionOptions = {}
): Promise<AgentReply> {
  const persistEvents = options.persistEvents ?? true;
  if (persistEvents) {
    persistChatMessage("user", message);
  }

  const result = await getRunner(config, options).generate(buildMessages(message, history), {
    maxSteps: 5,
  });

  if (persistEvents) {
    persistChatMessage("assistant", result.text);
  }

  return {
    reply: result.text,
    toolCalls: await resolveMaybePromise(result.toolCalls),
    toolResults: await resolveMaybePromise(result.toolResults),
  };
}

export async function streamAgentReply(
  message: string,
  history: AgentMessage[],
  config: PersonaConfig,
  callbacks: AgentStreamCallbacks,
  options: AgentSessionOptions = {}
): Promise<string> {
  const persistEvents = options.persistEvents ?? true;
  const runner = getRunner(config, options);

  if (persistEvents) {
    persistChatMessage("user", message);
  }

  try {
    if (!runner.stream) {
      const result = await generateAgentReply(message, history, config, {
        ...options,
        runner,
        persistEvents: false,
      });
      callbacks.onToken(result.reply);
      callbacks.onDone(result.reply);
      if (persistEvents) {
        persistChatMessage("assistant", result.reply);
      }
      return result.reply;
    }

    const stream = await runner.stream(buildMessages(message, history), {
      maxSteps: 5,
    });
    let fullText = "";

    for await (const chunk of stream.textStream as AsyncIterable<string>) {
      fullText += chunk;
      callbacks.onToken(chunk);
    }

    if (persistEvents) {
      persistChatMessage("assistant", fullText);
    }
    callbacks.onDone(fullText);
    return fullText;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError(error);
    return "";
  }
}
