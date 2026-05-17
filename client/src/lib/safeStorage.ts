type StorageKind = "localStorage" | "sessionStorage";

function getStorage(kind: StorageKind): Storage | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
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
  getItem: (key: string) => getStorageItem("localStorage", key),
  setItem: (key: string, value: string) => setStorageItem("localStorage", key, value),
  removeItem: (key: string) => removeStorageItem("localStorage", key),
} as const;
