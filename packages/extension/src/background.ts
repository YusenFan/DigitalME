/**
 * background.ts — Service Worker（Manifest V3 后台脚本）
 *
 * 职责：
 * 1. 接收 content script 发来的页面内容
 * 2. 追踪标签页焦点，计算 dwell time
 * 3. 检测标签页切换事件
 * 4. 每 30 秒批量发送事件给 daemon
 * 5. daemon 不可达时暂存到 IndexedDB 离线队列
 * 6. daemon 恢复后自动 flush 队列
 */

import type {
  BrowserEvent,
  ContentMessage,
  ExtensionSettings,
  ExtensionStatus,
  PopupMessage,
} from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { enqueue, peekAll, clearAll, getQueueSize } from "./lib/queue.js";

// ── 状态 ────────────────────────────────────────────────

/** 当前批次中待发送的事件 */
let eventBatch: BrowserEvent[] = [];

/** 今日已发送的事件计数 */
let eventsToday = 0;

/** daemon 是否可达 */
let daemonConnected = false;

/** 当前活跃标签页的追踪状态 */
let activeTab: {
  tabId: number;
  url: string;
  title: string;
  excerpt: string;
  startTime: number; // Date.now() 毫秒
} | null = null;

/** 缓存的设置 */
let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };

// ── 设置加载 ────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get("settings");
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ settings });
}

/**
 * 检查域名是否应该被采集。
 * blocklist 优先于 allowlist。
 */
function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;

    // blocklist 中的域名一律跳过
    if (settings.blocklist.some((d) => hostname === d || hostname.endsWith("." + d))) {
      return false;
    }

    // 如果 allowlist 非空，只采集 allowlist 中的域名
    if (settings.allowlist.length > 0) {
      return settings.allowlist.some((d) => hostname === d || hostname.endsWith("." + d));
    }

    return true;
  } catch {
    return false;
  }
}

// ── Content Script 消息处理 ─────────────────────────────

chrome.runtime.onMessage.addListener((message: ContentMessage | PopupMessage, _sender, sendResponse) => {
  if (message.type === "PAGE_CONTENT") {
    handlePageContent(message as ContentMessage);
  } else if (message.type === "GET_STATUS") {
    handleGetStatus().then(sendResponse);
    return true; // 异步响应
  } else if (message.type === "TOGGLE_PAUSE") {
    handleTogglePause().then(sendResponse);
    return true;
  } else if (message.type === "FLUSH_QUEUE") {
    flushOfflineQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
});

function handlePageContent(msg: ContentMessage): void {
  if (settings.paused) return;
  if (!isDomainAllowed(msg.url)) return;

  // 如果有正在追踪的标签页且 URL 变了，先结算 dwell time
  if (activeTab && activeTab.url !== msg.url) {
    finalizeDwell();
  }

  // 开始追踪新页面
  activeTab = {
    tabId: -1, // 稍后由 tab 事件更新
    url: msg.url,
    title: msg.title,
    excerpt: msg.excerpt,
    startTime: Date.now(),
  };
}

/** 结算当前活跃标签页的 dwell time 并加入批次 */
function finalizeDwell(): void {
  if (!activeTab) return;

  const dwellSec = Math.round((Date.now() - activeTab.startTime) / 1000);

  // 至少停留 2 秒才算有效（排除快速划过）
  if (dwellSec >= 2) {
    const event: BrowserEvent = {
      event_type: "page_visit",
      url: activeTab.url,
      title: activeTab.title,
      excerpt: activeTab.excerpt,
      dwell_time_sec: dwellSec,
      timestamp: new Date().toISOString(),
    };
    eventBatch.push(event);
  }

  activeTab = null;
}

// ── 标签页切换追踪 ─────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (settings.paused) return;

  // 切换标签页时，结算前一个标签页的 dwell time
  finalizeDwell();

  // 记录标签页切换事件
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && isDomainAllowed(tab.url)) {
      const event: BrowserEvent = {
        event_type: "tab_switch",
        url: tab.url,
        title: tab.title || "",
        timestamp: new Date().toISOString(),
      };
      eventBatch.push(event);

      // 开始追踪新标签页（但没有 excerpt，等 content script 发送）
      activeTab = {
        tabId: activeInfo.tabId,
        url: tab.url,
        title: tab.title || "",
        excerpt: "",
        startTime: Date.now(),
      };
    }
  } catch {
    // 标签页可能已关闭
  }
});

// 标签页关闭时结算 dwell time
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTab && activeTab.tabId === tabId) {
    finalizeDwell();
  }
});

// 窗口焦点变化（切到其他应用 = context switch）
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (settings.paused) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // 浏览器失去焦点 → 结算当前 dwell + 记录 context switch
    finalizeDwell();
    const event: BrowserEvent = {
      event_type: "context_switch",
      timestamp: new Date().toISOString(),
    };
    eventBatch.push(event);
  }
});

// ── 批量发送定时器 ─────────────────────────────────────

/** 每 30 秒尝试发送当前批次 */
const BATCH_INTERVAL_MS = 30_000;

async function sendBatch(): Promise<void> {
  if (eventBatch.length === 0) return;

  // 取出当前批次，清空缓冲区
  const batch = [...eventBatch];
  eventBatch = [];

  const url = `${settings.daemonUrl}/api/events/batch`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });

    if (response.ok) {
      const result = await response.json();
      eventsToday += result.inserted || batch.length;
      daemonConnected = true;

      // daemon 可达时，尝试 flush 离线队列
      await flushOfflineQueue();
    } else {
      // HTTP 错误 → 放入离线队列
      daemonConnected = false;
      for (const event of batch) {
        await enqueue(event);
      }
    }
  } catch {
    // 网络错误（daemon 未运行）→ 放入离线队列
    daemonConnected = false;
    for (const event of batch) {
      await enqueue(event);
    }
  }
}

/** 尝试发送离线队列中的事件 */
async function flushOfflineQueue(): Promise<void> {
  const queued = await peekAll();
  if (queued.length === 0) return;

  const url = `${settings.daemonUrl}/api/events/batch`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queued }),
    });

    if (response.ok) {
      await clearAll();
      const result = await response.json();
      eventsToday += result.inserted || queued.length;
      daemonConnected = true;
    }
  } catch {
    // daemon 仍然不可达，队列保留
  }
}

// ── Popup 通信处理 ──────────────────────────────────────

async function handleGetStatus(): Promise<ExtensionStatus> {
  const queueSize = await getQueueSize();
  return {
    paused: settings.paused,
    connected: daemonConnected,
    eventsToday,
    queueSize,
    daemonUrl: settings.daemonUrl,
  };
}

async function handleTogglePause(): Promise<{ paused: boolean }> {
  settings.paused = !settings.paused;
  await saveSettings();

  // 暂停时结算当前追踪
  if (settings.paused) {
    finalizeDwell();
  }

  return { paused: settings.paused };
}

// ── 监听设置变更（popup 修改 blocklist 等） ──────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings?.newValue) {
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  }
});

// ── 初始化 ──────────────────────────────────────────────

async function init(): Promise<void> {
  await loadSettings();

  // 检查 daemon 是否可达
  try {
    const response = await fetch(`${settings.daemonUrl}/api/status`);
    daemonConnected = response.ok;
  } catch {
    daemonConnected = false;
  }

  // 尝试 flush 离线队列
  if (daemonConnected) {
    await flushOfflineQueue();
  }
}

init();

// ── 定时批量发送 ────────────────────────────────────────
// Manifest V3 service worker 可能随时被终止。
// 使用 chrome.alarms 代替 setInterval 来保证可靠触发。

chrome.alarms.create("batch-send", { periodInMinutes: 0.5 }); // 30 秒

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "batch-send") {
    await sendBatch();
  }
});
