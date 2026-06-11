/// main.dart — Persona Engine 状态栏壳
///
/// 形态：LSUIElement 常驻 menu bar App（无 Dock 图标）。
/// 主窗口默认隐藏，v1 只是一个简单状态页；聊天入口在浏览器（daemon 的 /chat）。
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'daemon_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();

  const windowOptions = WindowOptions(
    size: Size(420, 320),
    center: true,
    title: 'Persona Engine',
  );
  // 启动时窗口隐藏由原生侧处理（MainFlutterWindow.hiddenWindowAtLaunch），
  // 这里只应用窗口参数，不调用 show()
  await windowManager.waitUntilReadyToShow(windowOptions);

  runApp(const PersonaShellApp());
}

class PersonaShellApp extends StatelessWidget {
  const PersonaShellApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'Persona Engine',
      debugShowCheckedModeBanner: false,
      home: ShellHome(),
    );
  }
}

class ShellHome extends StatefulWidget {
  const ShellHome({super.key});

  @override
  State<ShellHome> createState() => _ShellHomeState();
}

class _ShellHomeState extends State<ShellHome>
    with TrayListener, WindowListener {
  late final DaemonController controller;

  /// 上一次构建菜单时的"签名"，没变就不重建（避免轮询把打开的菜单顶掉）
  String _lastMenuSignature = '';

  @override
  void initState() {
    super.initState();
    trayManager.addListener(this);
    windowManager.addListener(this);
    windowManager.setPreventClose(true); // 关窗口 = 隐藏，不退出

    controller = DaemonController(onChanged: _onDaemonChanged);
    _initTray();
    controller.init();
  }

  @override
  void dispose() {
    trayManager.removeListener(this);
    windowManager.removeListener(this);
    super.dispose();
  }

  // ── Tray ──────────────────────────────────────────────

  Future<void> _initTray() async {
    // isTemplate: 让 macOS 自动适配浅色/深色菜单栏
    await trayManager.setIcon('assets/tray_icon.png', isTemplate: true);
    await _rebuildMenuIfChanged();
  }

  void _onDaemonChanged() {
    if (mounted) setState(() {});
    _rebuildMenuIfChanged();
  }

  /// 状态行文案，菜单和状态窗口共用
  String get _statusLine {
    switch (controller.state) {
      case DaemonState.stopped:
        return 'Status: Stopped';
      case DaemonState.starting:
        return 'Status: Starting…';
      case DaemonState.running:
      case DaemonState.external:
        final s = controller.status;
        final suffix = controller.state == DaemonState.external ? ' (external)' : '';
        if (s == null) return 'Status: Running$suffix';
        return 'Status: Running$suffix · ${s.uptimeLabel} · ${s.eventsToday} events today';
      case DaemonState.error:
        return 'Status: Error — ${controller.lastError ?? "unknown"}';
    }
  }

  Future<void> _rebuildMenuIfChanged() async {
    final state = controller.state;
    final isUp =
        state == DaemonState.running || state == DaemonState.external;
    final dreaming = controller.status?.dreamingRunning ?? false;

    final signature = '$state|$_statusLine|$dreaming';
    if (signature == _lastMenuSignature) return;
    _lastMenuSignature = signature;

    final dot = switch (state) {
      DaemonState.running || DaemonState.external => '🟢',
      DaemonState.starting => '🟡',
      DaemonState.error => '🔴',
      DaemonState.stopped => '⚪',
    };

    final menu = Menu(
      items: [
        MenuItem(key: 'title', label: '$dot Persona Engine', disabled: true),
        MenuItem.separator(),
        MenuItem(key: 'open_chat', label: 'Open Chat', disabled: !isUp),
        MenuItem(
          key: 'toggle_engine',
          label: state == DaemonState.stopped || state == DaemonState.error
              ? 'Start Persona Engine'
              : 'Stop Persona Engine',
          // external 实例不是我们 spawn 的，不接管，禁用 Stop
          disabled: state == DaemonState.external ||
              state == DaemonState.starting,
        ),
        MenuItem(key: 'status', label: _statusLine, disabled: true),
        MenuItem(
          key: 'run_dreaming',
          label: dreaming ? 'Dreaming…' : 'Run Dreaming Now',
          disabled: !isUp || dreaming,
        ),
        MenuItem(key: 'settings', label: 'Settings'),
        MenuItem.separator(),
        MenuItem(key: 'quit', label: 'Quit'),
      ],
    );
    await trayManager.setContextMenu(menu);
  }

  @override
  void onTrayIconMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    switch (menuItem.key) {
      case 'open_chat':
        controller.openChat();
      case 'toggle_engine':
        if (controller.state == DaemonState.stopped ||
            controller.state == DaemonState.error) {
          controller.start();
        } else {
          controller.stop();
        }
      case 'run_dreaming':
        controller.runDreamingNow();
      case 'settings':
        controller.openConfig();
      case 'quit':
        _quit();
    }
  }

  Future<void> _quit() async {
    await controller.dispose(); // 停轮询 + SIGTERM daemon（防孤儿 node 进程）
    await trayManager.destroy();
    await windowManager.destroy();
    exit(0);
  }

  // ── Window ────────────────────────────────────────────

  @override
  void onWindowClose() async {
    await windowManager.hide(); // 不退出 App
  }

  // ── 状态页（v1 极简，窗口默认不显示） ─────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Persona Engine')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_statusLine, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Text('Daemon: ${controller.baseUrl}'),
            const SizedBox(height: 12),
            const Text('一切操作都在菜单栏图标里；聊天界面在浏览器中打开。'),
            const SizedBox(height: 16),
            if (controller.recentLogs.isNotEmpty)
              Expanded(
                child: SingleChildScrollView(
                  child: Text(
                    controller.recentLogs.join('\n'),
                    style: const TextStyle(
                        fontFamily: 'Menlo', fontSize: 11),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
