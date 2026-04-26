import { describe, it, expect, vi, beforeEach } from "vitest";
import { migrateLegacyKeys } from "./storageMigration";

describe("migrateLegacyKeys", () => {
  let mockStorage: Storage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mockStorage = {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      length: 0,
      key: vi.fn((index: number) => Object.keys(store)[index] || null),
    } as unknown as Storage;
  });

  it("should return early if storage is falsy", () => {
    expect(() => migrateLegacyKeys(null as unknown as Storage)).not.toThrow();
    expect(() => migrateLegacyKeys(undefined as unknown as Storage)).not.toThrow();
  });

  it("should migrate old keys to new keys and remove old keys", () => {
    store["hyrox-offline-queue"] = "test-queue";
    store["hyrox-onboarding-complete"] = "true";

    migrateLegacyKeys(mockStorage);

    expect(store["hyrox-offline-queue"]).toBeUndefined();
    expect(store["fitai-offline-queue"]).toBe("test-queue");

    expect(store["hyrox-onboarding-complete"]).toBeUndefined();
    expect(store["fitai-onboarding-complete"]).toBe("true");

    expect(mockStorage.setItem).toHaveBeenCalledWith("fitai-offline-queue", "test-queue");
    expect(mockStorage.setItem).toHaveBeenCalledWith("fitai-onboarding-complete", "true");
    expect(mockStorage.removeItem).toHaveBeenCalledWith("hyrox-offline-queue");
    expect(mockStorage.removeItem).toHaveBeenCalledWith("hyrox-onboarding-complete");
  });

  it("should not overwrite existing new keys, but still remove old keys", () => {
    store["hyrox-offline-queue"] = "old-queue";
    store["fitai-offline-queue"] = "new-queue";

    migrateLegacyKeys(mockStorage);

    expect(store["hyrox-offline-queue"]).toBeUndefined();
    expect(store["fitai-offline-queue"]).toBe("new-queue");

    expect(mockStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.removeItem).toHaveBeenCalledWith("hyrox-offline-queue");
  });

  it("should handle storage errors gracefully", () => {
    mockStorage.getItem = vi.fn().mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => migrateLegacyKeys(mockStorage)).not.toThrow();
  });

  it("should do nothing if old key is not present", () => {
    migrateLegacyKeys(mockStorage);

    expect(mockStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.removeItem).not.toHaveBeenCalled();
  });
});
