/**
 * commands/config.ts — `persona config` 命令
 *
 * 查看或修改配置。
 *   - 无参数：显示当前完整配置（API key 会被遮蔽）
 *   - --set key=value：设置配置项（支持 dot notation）
 *   - --path：只打印配置文件路径
 */

import { Command } from "commander";
import { loadConfig, saveConfig, DATA_DIR } from "../../../daemon/src/config.js";
import type { PersonaConfig } from "../../../daemon/src/config.js";
import path from "node:path";

/**
 * 遮蔽 API key — 只显示前 6 和后 4 位。
 */
function maskConfig(config: PersonaConfig): Record<string, unknown> {
  const masked = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const llm = masked.llm as Record<string, string>;
  if (llm.apiKey && llm.apiKey.length > 10) {
    llm.apiKey = llm.apiKey.slice(0, 6) + "..." + llm.apiKey.slice(-4);
  } else if (llm.apiKey) {
    llm.apiKey = "***";
  }
  return masked;
}

/**
 * 通过 dot notation 路径设置嵌套对象的值。
 * 例如 setDeep(obj, "llm.model", "gpt-4o") → obj.llm.model = "gpt-4o"
 */
function setDeep(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      console.error(`Invalid config path: "${dotPath}" — "${key}" is not an object.`);
      process.exit(1);
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  if (!(finalKey in current)) {
    console.error(`Unknown config key: "${dotPath}".`);
    process.exit(1);
  }

  // 类型推断：如果现有值是 number，转换为 number
  const existingType = typeof current[finalKey];
  if (existingType === "number") {
    const parsed = Number(value);
    if (isNaN(parsed)) {
      console.error(`"${dotPath}" expects a number, got "${value}".`);
      process.exit(1);
    }
    current[finalKey] = parsed;
  } else if (existingType === "boolean") {
    current[finalKey] = value === "true";
  } else {
    current[finalKey] = value;
  }
}

export const configCommand = new Command("config")
  .description("View or update configuration")
  .option("--set <key=value>", "Set a config value (dot notation, e.g., llm.model=gpt-4o)")
  .option("--path", "Show config file path")
  .action((options) => {
    const config = loadConfig();

    if (options.path) {
      console.log(path.join(DATA_DIR, "config.json"));
      return;
    }

    if (options.set) {
      const eqIndex = (options.set as string).indexOf("=");
      if (eqIndex === -1) {
        console.error('Format: --set key=value (e.g., --set llm.model=gpt-4o)');
        process.exit(1);
      }
      const key = (options.set as string).slice(0, eqIndex);
      const value = (options.set as string).slice(eqIndex + 1);

      setDeep(config as unknown as Record<string, unknown>, key, value);
      saveConfig(config);
      console.log(`Set ${key} = ${value}`);
      return;
    }

    // 默认：显示完整配置
    const masked = maskConfig(config);
    console.log(JSON.stringify(masked, null, 2));
  });
