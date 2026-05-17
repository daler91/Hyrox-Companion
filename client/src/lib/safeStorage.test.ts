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
    expect(safeLocalStorage.canUse()).toBe(true);

    safeLocalStorage.setItem("fitai-test-key", "value");

    expect(safeLocalStorage.getItem("fitai-test-key")).toBe("value");

    safeLocalStorage.removeItem("fitai-test-key");

    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
  });

  it("returns null and ignores writes when storage is missing", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(safeLocalStorage.canUse()).toBe(false);
    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
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

    expect(safeLocalStorage.canUse()).toBe(false);
    expect(safeLocalStorage.getItem("fitai-test-key")).toBeNull();
    expect(() => safeLocalStorage.setItem("fitai-test-key", "value")).not.toThrow();
    expect(() => safeLocalStorage.removeItem("fitai-test-key")).not.toThrow();
  });
});
