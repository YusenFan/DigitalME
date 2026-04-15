/**
 * popup.ts — Extension Popup 逻辑
 *
 * 负责：
 * - 显示 daemon 连接状态
 * - 显示今日事件数和离线队列大小
 * - 暂停/恢复采集
 * - 编辑域名黑名单和 daemon URL
 */

import type { ExtensionSettings, ExtensionStatus } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

// ── DOM 元素 ────────────────────────────────────────────

const connectionBadge = document.getElementById("connection-badge")!;
const eventsCount = document.getElementById("events-count")!;
const queueCount = document.getElementById("queue-count")!;
const pauseBtn = document.getElementById("pause-btn")!;
const pauseIcon = document.getElementById("pause-icon")!;
const pauseText = document.getElementById("pause-text")!;
const blocklistInput = document.getElementById("blocklist") as HTMLTextAreaElement;
const daemonUrlInput = document.getElementById("daemon-url") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn")!;
const flushBtn = document.getElementById("flush-btn")!;

// ── 状态更新 ────────────────────────────────────────────

function updateUI(status: ExtensionStatus, settings: ExtensionSettings): void {
  // 连接状态
  if (status.paused) {
    connectionBadge.textContent = "paused";
    connectionBadge.className = "badge badge-paused";
  } else if (status.connected) {
    connectionBadge.textContent = "connected";
    connectionBadge.className = "badge badge-online";
  } else {
    connectionBadge.textContent = "offline";
    connectionBadge.className = "badge badge-offline";
  }

  // 计数
  eventsCount.textContent = String(status.eventsToday);
  queueCount.textContent = String(status.queueSize);

  // 暂停按钮
  if (status.paused) {
    pauseIcon.textContent = "\u25B6"; // ▶
    pauseText.textContent = "Resume";
  } else {
    pauseIcon.textContent = "\u23F8"; // ⏸
    pauseText.textContent = "Pause";
  }

  // Flush 按钮
  flushBtn.style.display = status.queueSize > 0 ? "flex" : "none";

  // 设置表单
  blocklistInput.value = settings.blocklist.join("\n");
  daemonUrlInput.value = settings.daemonUrl;
}

/** 从 background 获取当前状态 */
async function refreshStatus(): Promise<void> {
  try {
    const status: ExtensionStatus = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    const stored = await chrome.storage.local.get("settings");
    const settings: ExtensionSettings = { ...DEFAULT_SETTINGS, ...stored.settings };
    updateUI(status, settings);
  } catch {
    // background 不可达
    connectionBadge.textContent = "error";
    connectionBadge.className = "badge badge-offline";
  }
}

// ── 事件处理 ────────────────────────────────────────────

pauseBtn.addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "TOGGLE_PAUSE" });
    if (result) {
      await refreshStatus();
    }
  } catch {
    // ignore
  }
});

saveBtn.addEventListener("click", async () => {
  const blocklist = blocklistInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const daemonUrl = daemonUrlInput.value.trim() || DEFAULT_SETTINGS.daemonUrl;

  // 读取现有设置，只更新用户修改的部分
  const stored = await chrome.storage.local.get("settings");
  const current: ExtensionSettings = { ...DEFAULT_SETTINGS, ...stored.settings };

  const updated: ExtensionSettings = {
    ...current,
    blocklist,
    daemonUrl,
  };

  await chrome.storage.local.set({ settings: updated });

  // 视觉反馈
  saveBtn.textContent = "Saved!";
  setTimeout(() => {
    saveBtn.textContent = "Save Settings";
  }, 1500);
});

flushBtn.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "FLUSH_QUEUE" });
    await refreshStatus();
  } catch {
    // ignore
  }
});

// ── 初始化 ──────────────────────────────────────────────

refreshStatus();
