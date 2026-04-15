/**
 * commands/memory.ts — `persona memory` 命令
 *
 * 浏览 memory/ 目录结构。
 *   - 无参数：显示 memory/ 树状结构
 *   - 带参数：显示指定 category 下的文件内容
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "../../../daemon/src/config.js";

const MEMORY_DIR = path.join(DATA_DIR, "memory");

/**
 * 递归打印目录树。
 */
function printTree(dir: string, prefix = ""): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => {
      // 目录排前面
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDirectory()) {
      console.log(`${prefix}${connector}${entry.name}/`);
      printTree(path.join(dir, entry.name), prefix + childPrefix);
    } else {
      // 读取 YAML frontmatter 获取 decay_weight
      const filePath = path.join(dir, entry.name);
      const content = fs.readFileSync(filePath, "utf-8");
      const weightMatch = content.match(/decay_weight:\s*([\d.]+)/);
      const weight = weightMatch ? parseFloat(weightMatch[1]).toFixed(2) : "—";
      console.log(`${prefix}${connector}${entry.name}  (weight: ${weight})`);
    }
  }
}

export const memoryCommand = new Command("memory")
  .description("Browse memory/ directory")
  .argument("[category]", "Category to inspect (e.g., coding, research)")
  .action((category?: string) => {
    if (!fs.existsSync(MEMORY_DIR)) {
      console.log("No memory/ directory found. Run dreaming first with \"persona dream\".");
      return;
    }

    if (category) {
      const catDir = path.join(MEMORY_DIR, category);
      if (!fs.existsSync(catDir)) {
        // Maybe it's a file path like "coding/rust-learning.md"
        const filePath = path.join(MEMORY_DIR, category);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          console.log(fs.readFileSync(filePath, "utf-8"));
          return;
        }
        console.log(`Category "${category}" not found in memory/.`);
        console.log("Available categories:");
        const dirs = fs.readdirSync(MEMORY_DIR, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `  ${e.name}/`);
        console.log(dirs.join("\n") || "  (none)");
        return;
      }

      if (fs.statSync(catDir).isDirectory()) {
        console.log(`memory/${category}/`);
        console.log("─".repeat(40));
        const files = fs.readdirSync(catDir).filter((f) => f.endsWith(".md"));
        if (files.length === 0) {
          console.log("  (empty)");
          return;
        }
        for (const file of files) {
          const content = fs.readFileSync(path.join(catDir, file), "utf-8");
          const weightMatch = content.match(/decay_weight:\s*([\d.]+)/);
          const updatedMatch = content.match(/last_updated:\s*(.+)/);
          const weight = weightMatch ? parseFloat(weightMatch[1]).toFixed(2) : "—";
          const updated = updatedMatch ? updatedMatch[1].trim() : "—";
          console.log(`  ${file}  (weight: ${weight}, updated: ${updated})`);
        }
      } else {
        console.log(fs.readFileSync(catDir, "utf-8"));
      }
    } else {
      console.log("memory/");
      console.log("─".repeat(40));
      printTree(MEMORY_DIR);
    }
  });
