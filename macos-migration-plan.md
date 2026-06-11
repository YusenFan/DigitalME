# Persona Engine → macOS 状态栏 App：最小可行迁移方案

> 视角：资深 Flutter macOS 工程师。原则：daemon 不动（只允许一处小改动），Flutter 只做壳。
> 基于实际代码调研，不是泛泛架构（调研结论见 Phase 0）。

---

## 1. 最小架构

```
┌─────────────────────────────┐
│  Flutter macOS App（壳）      │
│  - 状态栏菜单（tray）          │
│  - spawn / kill node 子进程   │
│  - 轮询 GET /api/status      │
│  - Open Chat → 默认浏览器打开  │
│    http://127.0.0.1:19000/chat│
└──────────┬──────────────────┘
           │ Process.start("node", [daemon/dist/index.js])
           │ HTTP (localhost:19000)
┌──────────▼──────────────────┐
│  现有 Node daemon（零改动*）   │
│  Fastify + SQLite + dreaming │
│  数据：~/.persona-engine/     │
└─────────────────────────────┘
```

职责边界：

- Flutter：进程生命周期（启动/停止/崩溃检测）、状态栏菜单、健康轮询。不碰数据库、不碰文件监听、不实现任何业务逻辑。
- Daemon：保持现状。数据库、目录扫描、dreaming、HTTP API、LLM 调用全部不变。
- 通信方式只有一种：HTTP（localhost）。不做 stdin/stdout 协议，不做 FFI，不做 Swift bridge。

\* 唯一允许的 daemon 改动：新增 `POST /api/dreaming/run` 端点（见第 6 节决策 D4），约 15 行代码。原因：CLI `persona dream` 是直接打开 events.sqlite 跑 pipeline 的，daemon 运行中再开一个进程写同一个库，better-sqlite3 有并发风险。菜单触发 dreaming 必须走 daemon 进程内部。

另一个强烈建议（可选、约 5 行）：给 daemon 加 `--headless` 参数跳过 Ink TUI 渲染。当前 `index.tsx` 无条件 `render()`，从 Flutter spawn 时 stdout 是管道不是 TTY，Ink 会往管道里灌转义序列并维持每秒一次的刷新定时器。`persona start -b`（stdio: ignore）证明了不挂 TTY 能跑，所以 v1 不加也能工作，但 headless 更干净、日志可读。

## 2. macOS 状态栏形态

### Dock 图标：隐藏

建议 `LSUIElement = YES`（Info.plist）。理由：常驻型后台助手，Dock 图标只会让用户想去退出它。主窗口默认不创建/隐藏，点 "Open Chat" 才有界面（而且 v1 界面在浏览器里，见决策 D2）。

### 菜单结构（最小集）

```
● Persona Engine        ← 标题行，圆点反映状态（绿=running / 灰=stopped / 红=unhealthy）
─────────────
Open Chat               → 默认浏览器打开 http://127.0.0.1:19000/chat
Start / Stop Engine     → spawn / SIGTERM 子进程（daemon 已有 graceful shutdown）
Status: Running (uptime 2h, 1.2k events)   ← 只读，来自 /api/status
Run Dreaming Now        → POST /api/dreaming/run
Settings                → v1 仅打开 ~/.persona-engine/config.json（open -t 或 Finder reveal）
─────────────
Quit                    → 先 SIGTERM daemon，再退出 App
```

### Flutter 状态栏支持的限制（实话）

Flutter 本身**没有**任何状态栏/tray API，也没有"隐藏窗口启动"的 API。Flutter macOS 默认行为是：启动即弹主窗口、显示 Dock 图标。所以必须依赖插件 + 少量 Runner 配置：

| 插件 | 为什么必须 | 不用它的代价 |
|---|---|---|
| `tray_manager` | Flutter 无 tray API。它封装 NSStatusItem，支持菜单、图标、点击事件 | 自己写 Swift MethodChannel，违反"不做复杂 native bridge" |
| `window_manager` | 需要"启动时隐藏窗口、点菜单再显示、关窗口不退出 App"。Flutter 默认做不到 | 同上 |
| `launch_at_startup` | 仅 Phase 5 需要。封装 SMAppService 登录项 | 手写 Swift |

限制说明：tray_manager 的菜单是原生 NSMenu，够用但样式不可定制（v1 不需要定制）；动态更新菜单项（如 Status 行）需要重建菜单，轮询周期 5–10s 内体验没问题。`LSUIElement` 直接改 `macos/Runner/Info.plist`，不需要插件。

**先不要安装任何插件**——Phase 2 开始时再装这三个里的前两个，`launch_at_startup` 到 Phase 5 再说。

## 3. 迁移阶段

### Phase 0：确认现状（已完成调研，结论如下）

| 项目 | 事实 |
|---|---|
| 启动方式 | `node packages/daemon/dist/index.js`（tsup 产物，ESM）；或 CLI `persona start [-b]` |
| Node 要求 | >= 22（本机 v22.22.0）；含 native 模块 better-sqlite3 |
| 端口 | `127.0.0.1:19000`（config 可改，只绑本地） |
| Health | `GET /api/status`（含 uptime + 统计） |
| 聊天 | `POST /api/chat`（SSE 流式）；现成 Web UI 在 `GET /chat` |
| 数据目录 | `~/.persona-engine/`：config.json、events.sqlite、USER.md、memory/、daemon.pid |
| 退出 | 监听 SIGINT/SIGTERM，graceful shutdown；启动时自动清理 stale PID |
| 已知坑 1 | Ink TUI 无条件渲染（非 TTY 下能跑，但建议 `--headless`） |
| 已知坑 2 | 无 dreaming HTTP 端点，CLI dream 绕过 daemon 直开数据库 |
| 已知坑 3 | 端口被占时 listen 失败退出——可以反过来当"已有实例在跑"的信号 |
| 已知坑 4 | config.json 里有明文 API key——打包分发前注意，不要把数据目录打进 App |

验收：`pnpm build && node packages/daemon/dist/index.js` 后 `curl http://127.0.0.1:19000/api/status` 返回 200。

### Phase 1：创建 Flutter macOS shell

- 目标：空壳 App 能在本机跑起来，确认工具链。
- 改动范围：新增 `apps/macos_shell/`（`flutter create --platforms=macos`），现有代码零改动。
- 操作：`flutter run -d macos` 跑通；`open macos/Runner.xcworkspace` 在 Xcode 里确认能构建、签名用本地开发证书（Signing & Capabilities → Team 选 personal team 即可）。
- **立刻做一件关键事**：在 Xcode 里删掉 `Runner/*.entitlements` 中的 `com.apple.security.app-sandbox`（Flutter 模板默认开沙箱）。否则后面 spawn node、读 `~/.persona-engine` 全会失败，而且报错非常迷惑。这一步是整个迁移最容易踩的坑（详见第 4 节）。
- 验收：空窗口 App 在本机启动，Xcode 构建无签名报错，entitlements 里无 sandbox。

### Phase 2：状态栏 App + 基础窗口

- 目标：App 常驻 menu bar，无 Dock 图标，菜单可点（动作先打日志）。
- 改动范围：仅 `apps/macos_shell/`。安装 `tray_manager` + `window_manager`；Info.plist 加 `LSUIElement = YES`；启动时隐藏窗口，关窗口=隐藏不退出。
- 验收：启动后 Dock 无图标、menu bar 有图标；菜单含第 2 节全部条目；Quit 能真正退出。状态栏行为问题（图标不显示、菜单不弹）在 Xcode 里跑 Runner 看 Console 排查。

### Phase 3：Flutter 启动和管理 Node daemon

- 目标：菜单 Start/Stop 真正控制 daemon 进程。
- 改动范围：Flutter 内一个 `DaemonController` 类（Dart `Process.start`）。daemon 零改动（除非此时顺手加 `--headless`，建议加）。
- 实现要点：
  - dev 阶段直接用系统 node：`Process.start("node", [<repo>/packages/daemon/dist/index.js])`，路径先写死或放 App 内简单配置，打包问题留给 Phase 5。
  - Stop = `process.kill(SIGTERM)`，daemon 自己会 graceful shutdown 并清 PID 文件。
  - 启动失败检测：监听子进程 stderr + exitCode；端口被占（exit 非 0 且 /api/status 又通）= 外部已有实例，菜单显示 "Running (external)" 并且不接管。
  - Quit 时必须 kill 子进程（否则 node 变孤儿继续跑）。
- 验收：菜单 Start → 数秒内 `/api/status` 通；Stop → 进程消失、PID 文件被清；App 被强退后重开，能正确识别遗留状态。

### Phase 4：Flutter 通过 HTTP 调用 daemon

- 目标：菜单不再是摆设，状态实时。
- 改动范围：Flutter 内一个薄 HTTP client；daemon 加 `POST /api/dreaming/run`（本方案唯一 daemon 改动，复用 `runDreaming()`，已在 index.tsx 中 import，加锁防重入即可）。
- 实现：每 5–10s 轮询 `/api/status` 刷新菜单状态行和圆点；Run Dreaming Now → POST 后菜单短暂显示 "Dreaming…"；Open Chat → `open http://127.0.0.1:19000/chat`。
- 验收：拔掉 daemon（手动 kill -9）菜单 10s 内变红/灰；Run Dreaming Now 能在 daemon 日志里看到 pipeline 跑起来；Open Chat 在浏览器里能正常流式聊天。

### Phase 5：打包、权限、开机启动、数据目录

- 目标：双击 .app 在没有 dev 环境的前提下能跑（先只服务自己这台机器）。
- 改动范围：构建脚本（`scripts/bundle-daemon.sh`）+ Runner 配置。
- 内容：
  1. **捆绑 node 运行时**：把官方 node binary（arm64）+ `daemon/dist` + 生产 node_modules（关键是 better-sqlite3 的 .node 文件）拷进 `Runner.app/Contents/Resources/daemon/`。Flutter 端 spawn 路径从"写死的 repo 路径"切换为 `<bundle>/Resources/daemon/`。
  2. **数据目录**：保持 `~/.persona-engine/` 不变（daemon 代码决定的，不要动）。好处：CLI、TUI、App 三种方式打开的是同一份数据。
  3. **开机启动**：`launch_at_startup` 插件，Settings 菜单加个勾选项。
  4. **签名/公证**：自用阶段本地开发证书即可；要分发再走 Developer ID + notarization（hardened runtime 下 node 需要 `com.apple.security.cs.allow-jit` 等 entitlement，所有 .node 二进制要随包深度签名）。不要提前做。
- 验收：把 repo 临时改名，双击 .app，daemon 照常起来、数据还在。重启电脑 App 自启。

## 4. macOS 特有问题（提前想清楚）

- **App Sandbox：必须关掉**。这是本项目最重要的一条。daemon 要扫 `~/Documents/NUS`、iCloud Drive 等任意目录、要 spawn 子进程、数据在 `~/.persona-engine`——沙箱下全部做不到（子进程继承沙箱）。关掉沙箱意味着永远进不了 Mac App Store，对这个产品形态是正确取舍。在 Xcode 的 Signing & Capabilities 里确认没有 App Sandbox capability。
- **文件系统权限（TCC）**：即使无沙箱，首次访问 `~/Documents`、`~/Desktop`、`~/Downloads`、iCloud Drive 仍会触发系统弹窗。关键机制：node 是你 App 的子进程，TCC 把权限记在"responsible process"= 你的 .app 名下。所以弹窗会以 App 名义出现，授权一次即可。注意：终端里跑 daemon 时权限记在 Terminal 名下，**两边授权互不相通**，测试时别混淆。
- **Full Disk Access**：config 里扫描目录含 `~/Library/Mobile Documents`（iCloud），加上未来可能直接读浏览器本地数据，建议在 App 首次运行引导里直接让用户给 FDA（系统设置 → 隐私与安全 → 完全磁盘访问，把 .app 拖进去）。给了 FDA 就不再有逐目录弹窗。
- **Accessibility 权限**：v1 不需要。只有未来 proactive AI 要"观察前台 App / 模拟输入"时才需要，到时再说。
- **浏览器数据**：当前架构靠 Chrome extension 推送事件到 `:19000`，**不需要任何系统权限**，这是现有设计的优点，保持。不要改成直读 Chrome History sqlite（那才需要 FDA 且有文件锁问题）。
- **后台常驻**：LSUIElement App 没有 App Nap 大问题；daemon 是独立进程不受影响。无需 launchd 也能常驻，只要 App 活着。
- **开机启动**：用 SMAppService（`launch_at_startup` 封装），不要手写 LaunchAgent plist——那是另一条路线（见决策 D1）。
- **Notarization/签名**：分发时才做。坑预告：hardened runtime + node + native addon（better-sqlite3）需要 `--deep` 之外的逐文件签名和 JIT entitlement。自用阶段忽略。
- **子进程管理**：App crash 时 Dart 进程死了但 node 不一定死。最小对策：daemon 已有 PID 文件 + 端口探测，App 启动时先查 `/api/status`，活着就接管状态显示而不是再 spawn 一个。
- **SQLite 路径**：`~/.persona-engine/events.sqlite`，不变。不要放进 App bundle（bundle 只读且更新会被覆盖），不要迁去 `~/Library/Application Support`（v1 没必要，改了 CLI 就不兼容了）。
- **用户数据本地化**：现状已是 local-first，唯一注意点是 config.json 明文 API key——打包脚本里确保永远不会把 `~/.persona-engine` 或 repo 里的 `persona-engine/` 目录复制进 .app。

## 5. 目录结构建议

```
DigitalME/
├── apps/
│   └── macos_shell/          ← 新增，Flutter App（lib/ + macos/Runner）
├── packages/                 ← 完全不动
│   ├── cli/
│   ├── daemon/
│   ├── extension/
│   └── web-ui/
├── scripts/
│   └── bundle-daemon.sh      ← Phase 5 才出现
└── （其余现状保持）
```

新增一个 `apps/` 顶层目录即可，Flutter 项目不进 pnpm workspace（它不是 npm 包）。**什么时候才值得真正 monorepo 化**（统一版本号、CI 同时构建 daemon+App、release 流水线）：当你开始给别人分发签名版本时。在那之前，两个世界各自 build，靠 `bundle-daemon.sh` 缝合，足够。

## 6. 技术决策

- **D1 — spawn vs launch agent：v1 用 Flutter 直接 spawn。** 一个进程拥有者、生命周期清晰、调试简单、Quit 即全停。Launch agent 适合"App 没开 daemon 也要跑"的阶段（真 proactive 常驻），那是 v2 的事，且会引入"谁拥有 daemon"的双头问题。现在不要。
- **D2 — Flutter UI vs Web UI：v1 聊天用现成 Web UI**（`/chat`，浏览器打开）。daemon 已经有完整的 SSE 聊天页面，Flutter 重写聊天界面是纯重复劳动。Flutter 只负责菜单和状态。等聊天体验成为重点时，再评估 Flutter 内嵌（届时也优先考虑窗口内 webview 而不是重写）。
- **D3 — 菜单控制 daemon 还是只反映状态：控制。** 既然 App 是进程拥有者（D1），Start/Stop 必须在菜单里，否则用户没有任何停止手段（无 Dock、无窗口）。同时菜单也反映状态（轮询 /api/status），两者不冲突。
- **D4 — proactive AI 第一版怎么体现：不加新功能，只加一个"出口"。** Dreaming 本身已是 proactive 行为（nightly cron 已存在）。v1 仅做：dreaming 完成后状态栏图标短暂变化 + 状态行显示 "Last dreaming: 今晚 23:00 ✓"。连系统通知都可以先不做。这给未来 proactive 留了显示通道，而没有增加任何业务逻辑。

## 7. 风险与"不要做"清单

- 不要把 daemon 逻辑重写成 Dart——HTTP 边界已经足够干净，重写等于把六个 Phase 的工作再做一遍。
- 不要写 Swift bridge / MethodChannel——tray_manager + window_manager 覆盖了全部原生需求。
- 不要做权限系统——v1 就是"无沙箱 + 引导用户给 FDA"，没了。
- 不要做自动更新——Sparkle 等到有第二个用户再说。
- 不要改数据库 schema、不要迁移数据目录位置。
- 不要为了"更 native"重构（比如换 SwiftUI 状态栏、daemon 改 launchd service）。每一项都会让"最小迁移"变成季度项目。
- 风险点排序：① Flutter 模板默认沙箱没关（症状诡异，最先排查）；② Ink TUI 在管道 stdout 下的副作用（加 `--headless` 即消除）；③ App 强退留下孤儿 node 进程（启动时探测端口可缓解）；④ Phase 5 native 模块打包签名（自用阶段不会遇到）。

## 8. Xcode 的使用方式

- 日常开发跑 App：`cd apps/macos_shell && flutter run -d macos`（热重载可用）。
- 打开 Xcode：`open apps/macos_shell/macos/Runner.xcworkspace`（**必须是 .xcworkspace，不是 .xcodeproj**）。
- **适合在 Xcode 里解决的问题**：entitlements / App Sandbox 开关（Signing & Capabilities 面板）、Info.plist（LSUIElement）、签名团队和证书报错、状态栏图标不出现 / 菜单行为异常（跑 Runner scheme 看 Console 的 NSStatusItem 相关日志）、窗口显示/隐藏行为、**子进程启动失败**（Console 里能看到 posix_spawn / TCC denial / sandbox violation 日志，这类错误在 Flutter 侧只会表现为 Process.start 异常，没细节）。系统级排查还可配合 Console.app 过滤 "tccd"。
- **不要用 Xcode 解决的问题**：daemon 业务逻辑、HTTP API 行为、SQLite 数据问题、dreaming pipeline——这些一律在终端里直接 `node packages/daemon/dist/index.js` + curl 调试，和 Flutter 完全解耦，这正是这个架构的意义。
- 提醒：这是 macOS Runner 的真机调试，不存在模拟器概念；Xcode 里 scheme 选 Runner → My Mac 直接跑。

## 9. 下一步最小 Checklist

1. [ ] `pnpm build`，终端跑 `node packages/daemon/dist/index.js`，`curl localhost:19000/api/status` 确认 200（Phase 0 收尾）。
2. [ ] `flutter create apps/macos_shell --platforms=macos`，`flutter run -d macos` 跑通。
3. [ ] Xcode 打开 Runner.xcworkspace：删 entitlements 里的 App Sandbox，确认本地签名 OK。
4. [ ] Info.plist 加 `LSUIElement=YES`；装 tray_manager + window_manager；做出第 2 节的菜单（动作先打日志）。
5. [ ] 实现 DaemonController（spawn/SIGTERM/状态轮询），Start/Stop/Status 跑通。
6. [ ] daemon 加 `POST /api/dreaming/run`（+顺手加 `--headless`），接上 Run Dreaming Now 和 Open Chat。
7. [ ] （以上全通后才考虑）Phase 5 打包脚本。

第 1–3 步加起来不到一小时，先把"最容易踩的坑"（沙箱）排掉。
