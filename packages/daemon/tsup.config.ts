import { defineConfig } from "tsup";

export default defineConfig({
  // 入口文件 — daemon 只有一个入口
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // 不打包 node_modules 中的依赖，运行时从 node_modules 加载
  external: ["better-sqlite3", "ink", "react"],
});
