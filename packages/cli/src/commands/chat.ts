/**
 * commands/chat.ts — `persona chat` 命令
 *
 * 在终端中启动交互式聊天会话。
 * 使用 USER.md + memory/ 语义搜索增强的系统提示，
 * 流式输出 LLM 回复。
 *
 * 聊天记录存入 events.sqlite（event_type: chat_message）。
 */

import readline from "node:readline";
import { Command } from "commander";
import { loadConfig } from "../../../daemon/src/config.js";
import { initDatabase, closeDatabase } from "../../../daemon/src/db/events.js";
import { initVectorTable } from "../../../daemon/src/db/vectors.js";
import { chat, type ChatMessage } from "../../../daemon/src/chat/session.js";

export const chatCommand = new Command("chat")
  .description("Start an interactive chat with your persona-aware AI")
  .action(async () => {
    const config = loadConfig();
    if (!config.llm.apiKey) {
      console.error(
        "❌ No LLM API key configured. Run 'persona onboard' first or edit config.json."
      );
      process.exit(1);
    }

    // 初始化数据库 + 向量表
    initDatabase();
    initVectorTable();

    console.log("");
    console.log("💬 Persona Chat — your AI knows you");
    console.log("   Type your message and press Enter.");
    console.log("   Type 'exit' or Ctrl+C to quit.");
    console.log("");

    const history: ChatMessage[] = [];

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    /** 提问一轮 */
    function promptUser() {
      rl.question("\x1b[36myou>\x1b[0m ", async (input) => {
        const message = input.trim();

        if (!message) {
          promptUser();
          return;
        }

        if (message === "exit" || message === "quit") {
          console.log("\n👋 Bye!");
          cleanup();
          return;
        }

        // 流式输出助手回复
        process.stdout.write("\x1b[33mai>\x1b[0m ");

        try {
          const reply = await chat(message, history, config, {
            onToken(token) {
              process.stdout.write(token);
            },
            onDone() {
              process.stdout.write("\n\n");
            },
            onError(error) {
              process.stdout.write(`\n\n❌ Error: ${error.message}\n\n`);
            },
          });

          // 更新会话历史
          history.push({ role: "user", content: message });
          history.push({ role: "assistant", content: reply });

          // 保持历史在合理范围（最近 20 条消息）
          if (history.length > 20) {
            history.splice(0, history.length - 20);
          }
        } catch (err) {
          console.error(
            `\n❌ Chat error: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }

        promptUser();
      });
    }

    function cleanup() {
      rl.close();
      closeDatabase();
      process.exit(0);
    }

    // 处理 Ctrl+C
    rl.on("close", () => {
      console.log("\n👋 Bye!");
      cleanup();
    });

    promptUser();
  });
