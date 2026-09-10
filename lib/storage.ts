// IndexedDB keeps the draft in this browser. No remote persistence endpoint.
// https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
const DATABASE = 'nccu-travel-workbench';
const STORE = 'local-records';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('此瀏覽器無法開啟本機草稿。'));
    request.onblocked = () =>
      reject(new Error('請關閉其他分頁後重新開啟草稿。'));
  });
}
export async function readLocal<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}
let writes: Promise<void> = Promise.resolve();

/** Queue writes so a late autosave cannot replace a newer draft or undo action. */
export function writeLocalBatch(entries: Array<[string, unknown]>): Promise<void> {
  const operation = writes.catch(() => undefined).then(() => writeEntries(entries));
  writes = operation;
  return operation;
}
export function writeLocal(key: string, value: unknown): Promise<void> {
  return writeLocalBatch([[key, value]]);
}
async function writeEntries(entries: Array<[string, unknown]>): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('本機儲存失敗。'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
    try {
      for (const [key, value] of entries) transaction.objectStore(STORE).put(value, key);
    } catch (error) {
      // A synchronous quota/clone error must roll back earlier puts as well.
      transaction.abort();
      reject(error);
    }
  });
}
