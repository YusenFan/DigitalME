/// daemon_controller.dart — Node daemon 进程管理 + HTTP client
///
/// 职责（也是全部职责）：
///   1. spawn / SIGTERM node 子进程（daemon 业务逻辑完全不在这里）
///   2. 轮询 GET /api/status 判断健康状态
///   3. 转发菜单动作：POST /api/dreaming/run、打开 Web Chat、打开配置文件
///
/// 不碰数据库、不碰文件监听、不实现任何业务逻辑。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// daemon 的运行状态（从 App 视角看）
enum DaemonState {
  /// 没在跑
  stopped,

  /// 我们已 spawn 子进程，但 /api/status 还没就绪
  starting,

  /// 我们 spawn 的子进程，健康检查通过
  running,

  /// 端口上有别人启动的实例（比如终端里 persona start），我们只显示不接管
  external,

  /// 启动失败或子进程异常退出
  error,
}

/// GET /api/status 的解析结果（只取菜单需要的字段）
class DaemonStatus {
  DaemonStatus({
    required this.uptimeSec,
    required this.eventsToday,
    required this.dreamingRunning,
  });

  final int uptimeSec;
  final int eventsToday;
  final bool dreamingRunning;

  static DaemonStatus? fromJson(Map<String, dynamic> json) {
    if (json['daemon'] != 'running') return null;
    return DaemonStatus(
      uptimeSec: (json['uptime_sec'] as num?)?.toInt() ?? 0,
      eventsToday: (json['events_today'] as num?)?.toInt() ?? 0,
      dreamingRunning: json['dreaming_running'] == true,
    );
  }

  /// "2h 13m" 这样的人类可读 uptime
  String get uptimeLabel {
    final d = Duration(seconds: uptimeSec);
    if (d.inHours > 0) return '${d.inHours}h ${d.inMinutes % 60}m';
    if (d.inMinutes > 0) return '${d.inMinutes}m';
    return '${d.inSeconds}s';
  }
}

class DaemonController {
  DaemonController({required this.onChanged});

  /// 状态有变化时通知 UI（重建 tray 菜单）
  final void Function() onChanged;

  DaemonState state = DaemonState.stopped;
  DaemonStatus? status;
  String? lastError;

  Process? _process;
  Timer? _pollTimer;

  /// 最近的子进程输出，启动失败时给用户看
  final List<String> recentLogs = [];

  static const int _defaultPort = 19000;
  static const Duration _pollInterval = Duration(seconds: 5);

  late final int port = _readPortFromConfig();

  String get baseUrl => 'http://127.0.0.1:$port';

  String get homeDir => Platform.environment['HOME'] ?? '';

  // ── 生命周期 ──────────────────────────────────────────

  /// App 启动时调用：开始轮询。如果端口上已有实例（CLI 启动的）会自动识别为 external。
  void init() {
    _pollTimer = Timer.periodic(_pollInterval, (_) => refresh());
    refresh();
  }

  /// App 退出前调用：停轮询 + 停掉我们自己 spawn 的 daemon
  Future<void> dispose() async {
    _pollTimer?.cancel();
    await stop();
  }

  // ── Start / Stop ─────────────────────────────────────

  Future<void> start() async {
    if (state == DaemonState.running || state == DaemonState.starting) return;

    // 端口上已经有实例在跑（比如终端里 persona start）→ 不重复 spawn
    if (await _fetchStatus() != null) {
      state = DaemonState.external;
      onChanged();
      return;
    }

    final entry = _findDaemonEntry();
    if (entry == null) {
      state = DaemonState.error;
      lastError = '找不到 daemon/dist/index.js — 请先在仓库根目录运行 pnpm build';
      onChanged();
      return;
    }

    state = DaemonState.starting;
    lastError = null;
    onChanged();

    try {
      final process = await Process.start(_findNode(), [entry, '--headless']);
      _process = process;

      // 收集输出（只留最近 50 行，崩溃时排查用）
      process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_addLog);
      process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(_addLog);

      // 子进程退出回调。主动 stop() 时 _process 已被置空，不会走到 error 分支。
      process.exitCode.then((code) {
        if (_process != process) return;
        _process = null;
        status = null;
        if (code == 0) {
          state = DaemonState.stopped;
        } else {
          state = DaemonState.error;
          lastError = 'daemon 退出（code $code）：${recentLogs.isEmpty ? "无输出" : recentLogs.last}';
        }
        onChanged();
      });
    } catch (e) {
      state = DaemonState.error;
      lastError = '启动失败：$e';
      onChanged();
      return;
    }

    // 启动后密集探测健康状态（最多 ~10s），比等下一个 5s 轮询周期体验好
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      if (_process == null) return; // 已经挂了，exitCode 回调处理过了
      if (await _fetchStatus() != null) break;
    }
    await refresh();
  }

  Future<void> stop() async {
    final process = _process;
    if (process == null) return;

    _process = null; // 先置空，标记这是主动停止
    process.kill(ProcessSignal.sigterm); // daemon 自己会 graceful shutdown + 清 PID 文件

    // 最多等 5 秒，不退就强杀
    try {
      await process.exitCode.timeout(const Duration(seconds: 5));
    } on TimeoutException {
      process.kill(ProcessSignal.sigkill);
    }

    state = DaemonState.stopped;
    status = null;
    onChanged();
  }

  // ── 菜单动作 ──────────────────────────────────────────

  /// Open Chat — 用默认浏览器打开 daemon 自带的 Web UI
  Future<void> openChat() async {
    await Process.run('open', ['$baseUrl/chat']);
  }

  /// Settings — v1 只是用默认编辑器打开 config.json
  Future<void> openConfig() async {
    await Process.run('open', ['-t', '$homeDir/.persona-engine/config.json']);
  }

  /// Run Dreaming Now — POST /api/dreaming/run（409 = 已在跑，忽略即可）
  Future<void> runDreamingNow() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.postUrl(Uri.parse('$baseUrl/api/dreaming/run'));
      await request.close().timeout(const Duration(seconds: 3));
    } catch (_) {
      // daemon 没在跑，菜单项本来就该是禁用的，这里兜底忽略
    } finally {
      client.close(force: true);
    }
    await refresh();
  }

  // ── 健康轮询 ──────────────────────────────────────────

  Future<void> refresh() async {
    final json = await _fetchStatus();

    if (json != null) {
      status = DaemonStatus.fromJson(json);
      state = _process != null ? DaemonState.running : DaemonState.external;
    } else {
      status = null;
      if (_process == null &&
          (state == DaemonState.running || state == DaemonState.external)) {
        state = DaemonState.stopped;
      }
      // _process 非空但健康检查失败 → 可能还在启动中（保持 starting），
      // 真挂了由 exitCode 回调切到 error
    }
    onChanged();
  }

  Future<Map<String, dynamic>?> _fetchStatus() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(Uri.parse('$baseUrl/api/status'));
      final response = await request.close().timeout(const Duration(seconds: 3));
      if (response.statusCode != 200) return null;
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  // ── 路径解析 ──────────────────────────────────────────

  /// 找 node 可执行文件。
  /// Finder 启动的 GUI App 的 PATH 里通常没有 homebrew，所以先查常见绝对路径。
  String _findNode() {
    const candidates = [
      '/opt/homebrew/bin/node', // Apple Silicon homebrew
      '/usr/local/bin/node', // Intel homebrew / 官方 pkg
      '/usr/bin/node',
    ];
    for (final path in candidates) {
      if (File(path).existsSync()) return path;
    }
    return 'node'; // 兜底：靠 PATH（flutter run 启动时继承终端环境，可用）
  }

  /// 找 daemon 入口 JS，按优先级：
  ///   1. PERSONA_DAEMON_ENTRY 环境变量（调试覆盖用）
  ///   2. App bundle 内 Resources/daemon/index.js（Phase 5 打包后）
  ///   3. 开发模式：从可执行文件路径反推仓库根目录 → packages/daemon/dist/index.js
  String? _findDaemonEntry() {
    final envEntry = Platform.environment['PERSONA_DAEMON_ENTRY'];
    if (envEntry != null && File(envEntry).existsSync()) return envEntry;

    // resolvedExecutable = .../macos_shell.app/Contents/MacOS/macos_shell
    final exePath = Platform.resolvedExecutable;
    final contentsDir = File(exePath).parent.parent.path;
    final bundled = '$contentsDir/Resources/daemon/index.js';
    if (File(bundled).existsSync()) return bundled;

    // 开发模式下可执行文件位于 <repo>/apps/macos_shell/build/... 之下
    const marker = '/apps/macos_shell/build/';
    final markerIndex = exePath.indexOf(marker);
    if (markerIndex > 0) {
      final repoRoot = exePath.substring(0, markerIndex);
      final devEntry = '$repoRoot/packages/daemon/dist/index.js';
      if (File(devEntry).existsSync()) return devEntry;
    }

    return null;
  }

  /// 端口跟随 daemon 配置（~/.persona-engine/config.json），读不到就用默认值
  int _readPortFromConfig() {
    try {
      final file = File('$homeDir/.persona-engine/config.json');
      if (!file.existsSync()) return _defaultPort;
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final daemon = json['daemon'];
      if (daemon is Map<String, dynamic> && daemon['port'] is int) {
        return daemon['port'] as int;
      }
    } catch (_) {
      // 配置损坏不应该让壳起不来
    }
    return _defaultPort;
  }

  void _addLog(String line) {
    recentLogs.add(line);
    if (recentLogs.length > 50) recentLogs.removeAt(0);
  }
}
