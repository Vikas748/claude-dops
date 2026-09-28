export type OfflineOpdDraft = {
  id: string;
  body: Record<string, string>;
  createdAt: string;
  error?: string;
};

const dbName = "dops-offline",
  storeName = "opd-drafts";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode),
          request = run(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function queueOfflineOpd(body: Record<string, string>) {
  const draft: OfflineOpdDraft = {
    id: crypto.randomUUID(),
    body,
    createdAt: new Date().toISOString(),
  };
  return transaction("readwrite", (store) => store.put(draft)).then(() => draft);
}

export function listOfflineOpd() {
  return transaction<OfflineOpdDraft[]>("readonly", (store) => store.getAll());
}

export function removeOfflineOpd(id: string) {
  return transaction("readwrite", (store) => store.delete(id));
}

export function markOfflineOpdError(draft: OfflineOpdDraft, error: string) {
  return transaction("readwrite", (store) => store.put({ ...draft, error }));
}
