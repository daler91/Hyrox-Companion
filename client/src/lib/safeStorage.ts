type StorageKind = "localStorage" | "sessionStorage";
type StorageReadResult =
  | { ok: true; value: string | null }
  | { ok: false; value: null };

function getStorage(kind: StorageKind): Storage | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}

export function tryGetStorageItem(kind: StorageKind, key: string): StorageReadResult {
  const storage = getStorage(kind);
  if (!storage) return { ok: false, value: null };

  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

export function getStorageItem(kind: StorageKind, key: string): string | null {
  return tryGetStorageItem(kind, key).value;
}

export function setStorageItem(kind: StorageKind, key: string, value: string): void {
  try {
    getStorage(kind)?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing or hardened contexts.
  }
}

export function removeStorageItem(kind: StorageKind, key: string): void {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing or hardened contexts.
  }
}

export const safeLocalStorage = {
  getItem: (key: string) => getStorageItem("localStorage", key),
  tryGetItem: (key: string) => tryGetStorageItem("localStorage", key),
  setItem: (key: string, value: string) => setStorageItem("localStorage", key, value),
  removeItem: (key: string) => removeStorageItem("localStorage", key),
} as const;
