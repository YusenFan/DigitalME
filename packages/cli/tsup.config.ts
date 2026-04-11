import { defineConfig } from "tsup";

export default defineConfig({
  // CLI 入口文件
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // 在输出文件顶部添加 shebang，让系统知道用 node 执行
  banner: { js: "#!/usr/bin/env node" },
});
