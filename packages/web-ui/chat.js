/**
 * chat.js — Web 聊天 UI 前端脚本
 *
 * 通过 POST /api/chat 发送消息，接收 SSE 流式回复。
 * 维护本地会话历史。
 */

const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");

/** 会话历史 — 发送给后端以保持上下文 */
const history = [];

/** 添加消息气泡到界面 */
function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

/** 禁用/启用输入 */
function setLoading(loading) {
  input.disabled = loading;
  sendBtn.disabled = loading;
  if (!loading) input.focus();
}

/** 发送消息并处理 SSE 流 */
async function sendMessage(message) {
  // 显示用户消息
  addMessage("user", message);
  setLoading(true);

  // 创建助手消息气泡（流式填充）
  const assistantEl = addMessage("assistant", "");
  assistantEl.classList.add("streaming");

  let fullText = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行解析 SSE 数据
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留不完整的行

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6);
        try {
          const data = JSON.parse(jsonStr);

          if (data.type === "token") {
            fullText += data.content;
            assistantEl.textContent = fullText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (data.type === "done") {
            // 流结束
          } else if (data.type === "error") {
            throw new Error(data.content);
          }
        } catch (e) {
          if (e.message && !e.message.includes("JSON")) throw e;
        }
      }
    }

    // 更新历史
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: fullText });

    // 保持历史在合理范围
    while (history.length > 20) {
      history.shift();
    }
  } catch (err) {
    if (!fullText) {
      assistantEl.remove();
    }
    addMessage("error", `Error: ${err.message}`);
  } finally {
    assistantEl.classList.remove("streaming");
    setLoading(false);
  }
}

// ── 事件监听 ────────────────────────────────────────────

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  sendMessage(message);
});

// Enter 发送，Shift+Enter 换行（input 不支持换行所以直接 Enter 发送）
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event("submit"));
  }
});
