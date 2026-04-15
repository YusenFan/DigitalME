/**
 * chat/session.ts — 聊天会话管理
 *
 * 构建系统提示（USER.md + memory 上下文），管理会话历史，
 * 调用 LLM 生成流式回复，并将聊天消息存入 events.sqlite。
 */

import { streamText, type CoreMessage } from "ai";
import { createLlmModel, type LlmClientOptions } from "../onboarding/llm.js";
import { insertEvent } from "../db/events.js";
import { retrieveContext } from "./retrieval.js";
import type { PersonaConfig } from "../config.js";

// ── 类型定义 ────────────────────────────────────────────

/** 会话中的一条消息 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 流式回复的回调 */
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

// ── 系统提示构建 ────────────────────────────────────────

/**
 * 构建聊天系统提示。
 *
 * 结构：
 *   1. 角色说明
 *   2. USER.md 全文（让 LLM 了解用户）
 *   3. 相关 memory/ 片段（语义搜索结果）
 */
function buildSystemPrompt(
  userMd: string,
  memoryChunks: Array<{ path: string; content: string }>
): string {
  const parts: string[] = [];

  parts.push(`You are a personalized AI assistant for the user described below.
You have deep context about who they are, what they do, and what they care about.
Use this knowledge to give highly relevant, contextual responses.
Be natural, helpful, and concise. You can reference what you know about them when relevant.
If they ask about themselves, their patterns, or their work, draw from the persona and memory data.`);

  if (userMd) {
    parts.push(`\n## User Persona\n${userMd}`);
  }

  if (memoryChunks.length > 0) {
    parts.push("\n## Relevant Memories");
    for (const chunk of memoryChunks) {
      parts.push(`\n### ${chunk.path}\n${chunk.content}`);
    }
  }

  return parts.join("\n");
}

// ── 聊天核心 ────────────────────────────────────────────

/**
 * 发送聊天消息并获取流式回复。
 *
 * @param message  用户消息
 * @param history  之前的会话历史（不含当前消息）
 * @param config   完整配置
 * @param callbacks 流式回调
 * @returns 完整的助手回复文本
 */
export async function chat(
  message: string,
  history: ChatMessage[],
  config: PersonaConfig,
  callbacks: StreamCallbacks
): Promise<string> {
  // 1. 检索相关上下文
  const context = await retrieveContext(message, config);

  // 2. 构建系统提示
  const systemPrompt = buildSystemPrompt(
    context.userMd,
    context.memoryChunks
  );

  // 3. 构建消息列表（系统提示 + 历史 + 当前消息）
  const messages: CoreMessage[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  // 4. 将用户消息存为事件
  insertEvent({
    event_type: "chat_message",
    title: message.slice(0, 200),
    excerpt: message,
    source: "chat",
    metadata: { role: "user" },
  });

  // 5. 调用 LLM 流式生成
  const llmConfig: LlmClientOptions = {
    provider: config.llm.provider,
    model: config.llm.model,
    apiKey: config.llm.apiKey,
  };
  const model = createLlmModel(llmConfig);

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    maxTokens: 4000,
    temperature: 0.7,
  });

  // 6. 流式输出
  let fullText = "";
  try {
    for await (const chunk of result.textStream) {
      fullText += chunk;
      callbacks.onToken(chunk);
    }

    // 7. 将助手回复也存为事件
    insertEvent({
      event_type: "chat_message",
      title: fullText.slice(0, 200),
      excerpt: fullText.slice(0, 1000),
      source: "chat",
      metadata: { role: "assistant" },
    });

    callbacks.onDone(fullText);
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }

  return fullText;
}
