#!/usr/bin/env bash
#
# setup_macos_shell.sh — 在 Mac 上一键补全 Flutter macOS Runner 并打好补丁
#
# 做四件事：
#   1. flutter create 生成 macos/ Runner（不会覆盖已有的 lib/ 和 pubspec.yaml）
#   2. flutter pub get
#   3. Info.plist 加 LSUIElement=true（隐藏 Dock 图标，菜单栏常驻）
#   4. 删除 entitlements 里的 App Sandbox（daemon 要扫任意目录 + spawn node，沙箱下全做不到）
#
# 用法：bash scripts/setup_macos_shell.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$REPO_ROOT/apps/macos_shell"

if ! command -v flutter >/dev/null 2>&1; then
  echo "错误：找不到 flutter 命令。先安装 Flutter SDK 并加入 PATH。"
  exit 1
fi

cd "$SHELL_DIR"

# ── 1. 生成 macOS Runner ──────────────────────────────
# flutter create 默认不覆盖已存在的文件，所以 lib/ 和 pubspec.yaml 是安全的
echo "==> flutter create（生成 macos/ Runner）..."
flutter create --platforms=macos --project-name macos_shell --org com.personaengine .

# ── 2. 依赖 ───────────────────────────────────────────
echo "==> flutter pub get..."
flutter pub get

PLIST="macos/Runner/Info.plist"
PB="/usr/libexec/PlistBuddy"

# ── 3. LSUIElement：隐藏 Dock 图标 ────────────────────
echo "==> 设置 LSUIElement=true（无 Dock 图标）..."
"$PB" -c 'Add :LSUIElement bool true' "$PLIST" 2>/dev/null \
  || "$PB" -c 'Set :LSUIElement true' "$PLIST"

# ── 4. 移除 App Sandbox ───────────────────────────────
# Flutter 模板默认开沙箱。沙箱下：spawn node 失败、读 ~/.persona-engine 失败、
# daemon 扫描用户目录失败，且报错信息非常迷惑。本 App 形态必须关闭（不走 App Store）。
echo "==> 移除 App Sandbox entitlement..."
for f in macos/Runner/DebugProfile.entitlements macos/Runner/Release.entitlements; do
  if [ -f "$f" ]; then
    "$PB" -c 'Delete :com.apple.security.app-sandbox' "$f" 2>/dev/null || true
  fi
done

# ── 5. window_manager 必需的原生集成（幂等） ──────────
# 5a. AppDelegate：窗口关闭/隐藏时不退出 App（模板默认 true 会导致启动即静默退出）
echo "==> 修补 AppDelegate（last window closed 不退出）..."
python3 - << 'PYEOF'
from pathlib import Path
f = Path("macos/Runner/AppDelegate.swift")
src = f.read_text()
old = """  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }"""
new = """  // 菜单栏常驻 App：窗口关闭/隐藏时不能退出整个 App（Flutter 模板默认 true，必须改 false）
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return false
  }"""
if old in src:
    f.write_text(src.replace(old, new))
    print("    patched")
else:
    print("    already patched / template changed, skip")
PYEOF

# 5b. MainFlutterWindow：window_manager 官方 "Hidden at launch" 集成
echo "==> 修补 MainFlutterWindow（启动时隐藏窗口）..."
python3 - << 'PYEOF'
from pathlib import Path
f = Path("macos/Runner/MainFlutterWindow.swift")
src = f.read_text()
if "hiddenWindowAtLaunch" in src:
    print("    already patched, skip")
else:
    src = src.replace(
        "import FlutterMacOS",
        "import FlutterMacOS\nimport window_manager",
        1,
    )
    src = src.replace(
        "    super.awakeFromNib()\n  }",
        """    super.awakeFromNib()
  }

  // window_manager 官方 "Hidden at launch" 集成：
  // 启动时窗口不显示（菜单栏才是主入口），避免窗口闪现和启动期竞态
  override public func order(_ place: NSWindow.OrderingMode, relativeTo otherWin: Int) {
    super.order(place, relativeTo: otherWin)
    hiddenWindowAtLaunch()
  }""",
        1,
    )
    f.write_text(src)
    print("    patched")
PYEOF

echo ""
echo "完成。下一步："
echo "  1. 构建 daemon（如果还没构建）：  cd \"$REPO_ROOT\" && pnpm build"
echo "  2. 跑 App：                      cd \"$SHELL_DIR\" && flutter run -d macos"
echo "  3. 或在 Xcode 里调试：           open \"$SHELL_DIR/macos/Runner.xcworkspace\""
echo ""
echo "首次运行注意："
echo "  - 启动后没有窗口是正常的，看屏幕右上角菜单栏的圆环图标"
echo "  - 菜单点 Start Persona Engine 后，首次访问 ~/Documents 等目录会弹系统授权框"
