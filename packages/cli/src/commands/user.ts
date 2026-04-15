/**
 * commands/user.ts — `persona user` 命令
 *
 * 查看或编辑 USER.md。
 *   - 无参数：在终端打印 USER.md 内容
 *   - --edit：用 $EDITOR 打开 USER.md 进行编辑
 */

import { Command } from "commander";
import fs from "node:fs";
import { execSync } from "node:child_process";

import { USER_MD_PATH } from "../../../daemon/src/config.js";

export const userCommand = new Command("user")
  .description("View or edit your USER.md persona file")
  .option("-e, --edit", "Open USER.md in $EDITOR for editing")
  .action((options) => {
    if (!fs.existsSync(USER_MD_PATH)) {
      console.log("USER.md not found. Run \"persona onboard\" first.");
      process.exit(1);
    }

    if (options.edit) {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      try {
        execSync(`${editor} "${USER_MD_PATH}"`, { stdio: "inherit" });
        console.log("USER.md saved.");
      } catch {
        console.error(`Failed to open editor "${editor}".`);
        process.exit(1);
      }
    } else {
      const content = fs.readFileSync(USER_MD_PATH, "utf-8");
      console.log(content);
    }
  });
