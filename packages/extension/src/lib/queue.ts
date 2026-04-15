/**
 * lib/queue.ts — IndexedDB 离线事件队列
 *
 * 当 daemon 不可达时，事件暂存在 IndexedDB 中。
 * daemon 恢复后自动批量发送。上限 1000 条，超过后丢弃最旧的。
 */

import type { BrowserEvent } from "../types.js";

const DB_NAME = "persona-engine-queue";
const DB_VERSION = 1;
const STORE_NAME = "events";
const MAX_QUEUE_SIZE = 1000;

/** 打开 IndexedDB（创建或升级 schema） */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 将一个事件加入离线队列 */
export async function enqueue(event: BrowserEvent): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // 检查队列大小，超过上限时删除最旧的
  const countReq = store.count();
  await new Promise<void>((resolve) => {
    countReq.onsuccess = () => {
      if (countReq.result >= MAX_QUEUE_SIZE) {
        // 删除最旧的一条（id 最小的）
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) {
            cursor.result.delete();
          }
          resolve();
        };
        cursor.onerror = () => resolve();
      } else {
        resolve();
      }
    };
  });

  store.add({ ...event, queued_at: new Date().toISOString() });

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

/** 获取队列中所有事件（不删除） */
export async function peekAll(): Promise<BrowserEvent[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result as BrowserEvent[]);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** 清空整个队列（发送成功后调用） */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

/** 获取队列中的事件数量 */
export async function getQueueSize(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => {
      db.close();
      resolve(req.result);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}
