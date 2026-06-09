/**
 * commands/memory.ts — `persona memory` 命令
 *
 * 浏览 mem0 管理的长期记忆。
 */

import { Command } from "commander";

import { loadConfig } from "../../../daemon/src/config.js";

export const memoryCommand = new Command("memory")
  .description("Browse long-term memories")
  .argument("[category]", "Category/path/id to inspect (e.g., coding, research)")
  .action(async (category?: string) => {
    const { listMemories } = await import("../../../daemon/src/memory/mem0.js");
    const config = loadConfig();
    const memories = await listMemories(config);
    const filtered = category
      ? memories.filter((memory) => {
          return (
            memory.path === category ||
            memory.path.startsWith(`${category}/`) ||
            memory.id === category
          );
        })
      : memories;

    if (filtered.length === 0) {
      console.log("No memories found. Run dreaming first with \"persona dream\".");
      return;
    }

    if (category) {
      for (const memory of filtered) {
        console.log(`# ${memory.path}`);
        console.log("");
        console.log(memory.content);
        console.log("");
      }
      return;
    }

    console.log("mem0 memories");
    console.log("─".repeat(40));
    for (const memory of filtered) {
      const updated = memory.updatedAt ?? memory.createdAt ?? "—";
      console.log(`${memory.path}  (${memory.id}, updated: ${updated})`);
      console.log(`  ${memory.content}`);
    }
  });
