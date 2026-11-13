// Phone storage: the outbox (answers not yet on GitHub) and a cache of GitHub objects by id.
const DB = "pca-practice";
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("outbox", { keyPath: "id" });
      req.result.createObjectStore("cache");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const outboxAll = () => run("outbox", "readonly", (s) => s.getAll());
export const outboxPut = (answer) => run("outbox", "readwrite", (s) => s.put(answer));
export const outboxDelete = (ids) => run("outbox", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); });
export const cacheGet = (key) => run("cache", "readonly", (s) => s.get(key));
export const cachePut = (key, value) => run("cache", "readwrite", (s) => s.put(value, key));

export async function keepStorage() {
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
}
