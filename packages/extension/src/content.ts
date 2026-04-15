/**
 * content.ts — Content Script
 *
 * 在每个页面上运行（document_idle 时机），使用 Readability.js
 * 提取干净的文章文本，然后发送给 background service worker。
 *
 * 不做任何网络请求 — 只负责提取内容并传消息。
 */

import { Readability } from "@mozilla/readability";
import type { ContentMessage } from "./types.js";

/**
 * 提取当前页面的正文内容。
 *
 * 策略：
 * 1. 优先用 Readability.js 提取（干净的文章文本）
 * 2. 如果 Readability 失败（SPA、非文章页面），
 *    fallback 到 document.body.innerText 前 1000 字符
 */
function extractContent(): string {
  try {
    // Readability 会修改 DOM，所以先 clone 整个 document
    const clone = document.cloneNode(true) as Document;
    const reader = new Readability(clone);
    const article = reader.parse();

    if (article?.textContent) {
      // 截取前 1000 字符（配合 daemon 的 excerptMaxChars 设置）
      return article.textContent.trim().slice(0, 1000);
    }
  } catch {
    // Readability 解析失败，使用 fallback
  }

  // Fallback：直接取 body 文本
  const text = document.body?.innerText || "";
  return text.trim().slice(0, 1000);
}

/**
 * 判断当前页面是否值得采集。
 * 跳过空白页、扩展页面、浏览器内部页面等。
 */
function shouldCapture(): boolean {
  const url = location.href;

  // 跳过非 HTTP 页面
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return false;
  }

  // 跳过常见的无内容页面
  if (url === "about:blank" || url === "chrome://newtab/") {
    return false;
  }

  return true;
}

// ── 主逻辑 ────────────────────────────────────────────────

function main() {
  if (!shouldCapture()) return;

  const excerpt = extractContent();
  // 内容太短（< 50 字符）的页面通常没有有意义的内容
  if (excerpt.length < 50) return;

  const message: ContentMessage = {
    type: "PAGE_CONTENT",
    url: location.href,
    title: document.title || "",
    excerpt,
  };

  // 发送给 background service worker
  chrome.runtime.sendMessage(message).catch(() => {
    // 扩展被禁用或 service worker 未就绪时忽略错误
  });
}

main();
