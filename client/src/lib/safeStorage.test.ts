import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safeLocalStorage } from "./safeStorage";

describe("safeLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets, sets, and removes values when storage is available", () => {
    safeLocalStorage.setItem("fitai-test-key", "value");

    expect(safeLocalStorage.getItem("fitai-test-key")).toBe("value");
    expect(safeLocalStorage.tryGetItem("fitai-test-key")).toEqual({ ok: true, value: "value" });

    safeLocalStorage.removeItem("fitai-test-key");

    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
  });

  it("returns null and ignores writes when storage is missing", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
    expect(safeLocalStorage.tryGetItem("fitai-test-key")).toEqual({ ok: false, value: null });
    expect(() => safeLocalStorage.setItem("fitai-test-key", "value")).not.toThrow();
    expect(() => safeLocalStorage.removeItem("fitai-test-key")).not.toThrow();
  });

  it("returns null and ignores writes when storage throws", () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
    };
    vi.stubGlobal("localStorage", throwingStorage);

    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
    expect(safeLocalStorage.tryGetItem("fitai-test-key")).toEqual({ ok: false, value: null });
    expect(() => safeLocalStorage.setItem("fitai-test-key", "value")).not.toThrow();
    expect(() => safeLocalStorage.removeItem("fitai-test-key")).not.toThrow();
  });

  it("does not write probe keys when checking read availability", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);

    expect(safeLocalStorage.tryGetItem("fitai-test-key")).toEqual({ ok: true, value: null });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
