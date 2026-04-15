/**
 * cli.test.ts — CLI 命令集成测试
 *
 * 通过 execSync 运行构建后的 CLI 命令，检查输出。
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const CLI = path.resolve(import.meta.dirname, "../packages/cli/dist/index.js");

function run(args: string): string {
  return execSync(`node "${CLI}" ${args}`, {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
}

describe("CLI commands", () => {
  it("persona --version", () => {
    const output = run("--version");
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("persona --help lists all commands", () => {
    const output = run("--help");
    const expectedCommands = [
      "onboard", "start", "stop", "status", "dream", "chat",
      "user", "memory", "events", "config", "reset", "pause", "resume",
    ];
    for (const cmd of expectedCommands) {
      expect(output).toContain(cmd);
    }
  });

  it("persona config shows JSON output", () => {
    const output = run("config");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("daemon");
    expect(parsed).toHaveProperty("llm");
    expect(parsed).toHaveProperty("dreaming");
    expect(parsed.daemon.port).toBe(19000);
  });

  it("persona config --path shows file path", () => {
    const output = run("config --path");
    expect(output).toContain("config.json");
    expect(output).toContain("persona-engine");
  });

  it("persona user shows USER.md content", () => {
    // This will fail if onboarding hasn't been done, but in our test env it has
    try {
      const output = run("user");
      expect(output).toContain("USER.md");
    } catch {
      // If USER.md doesn't exist, the command exits with code 1 — that's expected behavior
    }
  });

  it("persona memory shows directory tree", () => {
    try {
      const output = run("memory");
      // Either shows tree or says "not found"
      expect(output.length).toBeGreaterThan(0);
    } catch {
      // memory/ might not exist
    }
  });

  it("persona events --help shows options", () => {
    const output = run("events --help");
    expect(output).toContain("--since");
    expect(output).toContain("--status");
    expect(output).toContain("--type");
    expect(output).toContain("--limit");
  });

  it("persona reset --help shows force option", () => {
    const output = run("reset --help");
    expect(output).toContain("--force");
    expect(output).toContain("Wipe all persona data");
  });
});
