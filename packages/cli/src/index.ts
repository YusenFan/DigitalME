/**
 * cli/index.ts — CLI 入口文件（Commander.js 命令路由）
 *
 * 注册所有子命令，解析命令行参数后分发到对应的 handler。
 * 构建后输出到 dist/index.js，通过 package.json 的 bin 字段
 * 注册为全局命令 `persona`。
 */

import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { onboardCommand } from "./commands/onboard.js";
import { dreamCommand } from "./commands/dream.js";
import { chatCommand } from "./commands/chat.js";

const program = new Command();

program
  .name("persona")
  .description("Persona Engine — a system that actively understands you")
  .version("0.1.0");

// 注册子命令
program.addCommand(onboardCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(statusCommand);
program.addCommand(dreamCommand);
program.addCommand(chatCommand);

// 解析命令行参数并执行
program.parse();
