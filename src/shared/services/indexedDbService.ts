import type { WorkspaceDocument } from "../domain/types";

const DATABASE = "latency-lab-db";
const STORE = "workspace";
const KEY = "latency-lab.workspace.v1";

export class IndexedDbService {
  async read(): Promise<unknown> {
    if (!("indexedDB" in globalThis)) throw new Error("浏览器不支持 IndexedDB");
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("读取本地项目失败"));
    });
  }

  async write(value: WorkspaceDocument): Promise<void> {
    if (!("indexedDB" in globalThis)) throw new Error("浏览器不支持 IndexedDB");
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("保存本地项目失败"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("保存已中断"));
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("打开本地项目失败"));
    });
  }
}
