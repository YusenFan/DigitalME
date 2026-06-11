/// DaemonStatus 解析测试 — 纯 Dart，不依赖 tray/window 插件。
/// （进程管理和 tray 行为依赖原生环境，在 Mac 上手动验收，见 NOTE.md Phase 8）
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:macos_shell/daemon_controller.dart';

void main() {
  group('DaemonStatus.fromJson', () {
    test('解析正常的 /api/status 响应', () {
      final status = DaemonStatus.fromJson({
        'daemon': 'running',
        'uptime_sec': 7980, // 2h 13m
        'events_today': 1234,
        'dreaming_running': true,
      });

      expect(status, isNotNull);
      expect(status!.uptimeSec, 7980);
      expect(status.eventsToday, 1234);
      expect(status.dreamingRunning, true);
      expect(status.uptimeLabel, '2h 13m');
    });

    test('daemon 字段不是 running 时返回 null', () {
      expect(DaemonStatus.fromJson({'daemon': 'stopped'}), isNull);
    });

    test('缺失字段时用默认值，不抛异常', () {
      final status = DaemonStatus.fromJson({'daemon': 'running'});
      expect(status, isNotNull);
      expect(status!.uptimeSec, 0);
      expect(status.eventsToday, 0);
      expect(status.dreamingRunning, false);
    });

    test('uptimeLabel 短时长格式', () {
      expect(
        DaemonStatus(uptimeSec: 45, eventsToday: 0, dreamingRunning: false)
            .uptimeLabel,
        '45s',
      );
      expect(
        DaemonStatus(uptimeSec: 300, eventsToday: 0, dreamingRunning: false)
            .uptimeLabel,
        '5m',
      );
    });
  });
}
