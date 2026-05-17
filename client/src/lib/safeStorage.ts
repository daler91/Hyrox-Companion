type StorageKind = "localStorage" | "sessionStorage";

function getStorage(kind: StorageKind): Storage | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}

export function canUseStorage(kind: StorageKind): boolean {
  try {
    const storage = getStorage(kind);
    if (!storage) return false;
    const testKey = "__fitai_storage_probe__";
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function getStorageItem(kind: StorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
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
  canUse: () => canUseStorage("localStorage"),
  getItem: (key: string) => getStorageItem("localStorage", key),
  setItem: (key: string, value: string) => setStorageItem("localStorage", key, value),
  removeItem: (key: string) => removeStorageItem("localStorage", key),
} as const;
