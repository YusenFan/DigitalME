/**
 * types.ts — Extension 内部共享类型
 */

/** 发送给 daemon 的事件结构 */
export interface BrowserEvent {
  event_type: "page_visit" | "tab_switch" | "context_switch";
  url?: string;
  title?: string;
  excerpt?: string;
  dwell_time_sec?: number;
  timestamp?: string;
}

/** content script → background 的消息 */
export interface ContentMessage {
  type: "PAGE_CONTENT";
  url: string;
  title: string;
  excerpt: string;
}

/** popup → background 的消息 */
export interface PopupMessage {
  type: "GET_STATUS" | "TOGGLE_PAUSE" | "FLUSH_QUEUE";
}

/** background → popup 的状态响应 */
export interface ExtensionStatus {
  paused: boolean;
  connected: boolean;
  eventsToday: number;
  queueSize: number;
  daemonUrl: string;
}

/** 存储在 chrome.storage.local 中的设置 */
export interface ExtensionSettings {
  daemonUrl: string;
  paused: boolean;
  blocklist: string[]; // 不采集的域名
  allowlist: string[]; // 只采集的域名（空 = 全部）
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  daemonUrl: "http://127.0.0.1:19000",
  paused: false,
  blocklist: [],
  allowlist: [],
};
