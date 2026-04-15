/**
 * package.js — 打包 Chrome 扩展为 .zip 文件
 *
 * 收集所有必要文件（manifest.json, dist/, popup.html, popup.css, icons/）
 * 生成 persona-extension-v{version}.zip，可直接用于 Chrome sideload 或分发。
 *
 * 用法：node scripts/package.js
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const outName = `persona-extension-v${pkg.version}.zip`;
const outPath = path.join(ROOT, outName);

// 确保已构建
if (!fs.existsSync(path.join(ROOT, "dist"))) {
  console.log("Building extension first...");
  execSync("pnpm build", { cwd: ROOT, stdio: "inherit" });
}

// 要打包的文件/目录
const includes = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "dist/",
  "icons/",
].filter((f) => fs.existsSync(path.join(ROOT, f)));

// 删除旧的 zip
if (fs.existsSync(outPath)) {
  fs.unlinkSync(outPath);
}

// 使用 zip 命令打包
const files = includes.join(" ");
execSync(`cd "${ROOT}" && zip -r "${outName}" ${files}`, { stdio: "inherit" });

console.log(`\nPackaged: ${outName}`);
console.log(`Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
console.log("\nTo sideload:");
console.log("  1. Unzip to a folder");
console.log("  2. Open chrome://extensions/");
console.log('  3. Enable "Developer mode"');
console.log('  4. Click "Load unpacked" → select the unzipped folder');
