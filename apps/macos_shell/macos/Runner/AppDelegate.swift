import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  // 菜单栏常驻 App：窗口关闭/隐藏时不能退出整个 App（Flutter 模板默认 true，必须改 false）
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return false
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }
}
