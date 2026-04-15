import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts",
  },
  outDir: "dist",
  format: ["esm"], // Chrome Manifest V3 service worker 支持 ES modules
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/], // 把所有依赖打包进去（extension 不能用 node_modules）
  outExtension: () => ({ js: ".js" }), // 强制 .js 后缀（不加 .mjs）
});
