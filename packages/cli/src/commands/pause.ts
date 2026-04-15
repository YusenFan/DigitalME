/**
 * commands/pause.ts — `persona pause` / `persona resume` 命令
 *
 * 暂停或恢复浏览器事件采集。
 * 通过修改 config.json 中 collection.browser.enabled 来控制。
 * daemon 的 HTTP API 会检查这个字段，暂停时拒绝新事件。
 */

import { Command } from "commander";
import { loadConfig, saveConfig } from "../../../daemon/src/config.js";

export const pauseCommand = new Command("pause")
  .description("Pause browser event collection")
  .action(() => {
    const config = loadConfig();
    if (!config.collection.browser.enabled) {
      console.log("Collection is already paused.");
      return;
    }
    config.collection.browser.enabled = false;
    saveConfig(config);
    console.log("Event collection paused.");
    console.log("Use \"persona resume\" to resume.");
  });

export const resumeCommand = new Command("resume")
  .description("Resume browser event collection")
  .action(() => {
    const config = loadConfig();
    if (config.collection.browser.enabled) {
      console.log("Collection is already active.");
      return;
    }
    config.collection.browser.enabled = true;
    saveConfig(config);
    console.log("Event collection resumed.");
  });
