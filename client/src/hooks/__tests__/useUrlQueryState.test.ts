import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUrlQueryState } from "../useUrlQueryState";

describe("useUrlQueryState", () => {
  beforeEach(() => {
    globalThis.window.history.replaceState(null, "", "/");
  });

  it("returns the default value when the query param is absent", () => {
    const { result } = renderHook(() => useUrlQueryState("status", "all"));
    expect(result.current[0]).toBe("all");
  });

  it("reads the initial value from the URL on mount", () => {
    globalThis.window.history.replaceState(null, "", "/?status=completed");
    const { result } = renderHook(() => useUrlQueryState("status", "all"));
    expect(result.current[0]).toBe("completed");
  });

  it("writes to the URL when the setter is called", () => {
    const { result } = renderHook(() => useUrlQueryState("status", "all"));
    act(() => {
      result.current[1]("missed");
    });
    expect(result.current[0]).toBe("missed");
    expect(globalThis.window.location.search).toBe("?status=missed");
  });

  it("removes the query param when set back to the default value", () => {
    globalThis.window.history.replaceState(null, "", "/?status=completed");
    const { result } = renderHook(() => useUrlQueryState("status", "all"));
    act(() => {
      result.current[1]("all");
    });
    expect(globalThis.window.location.search).toBe("");
  });

  it("ignores URL values not in the allowed list", () => {
    globalThis.window.history.replaceState(null, "", "/?status=bogus");
    const { result } = renderHook(() =>
      useUrlQueryState("status", "all", ["all", "completed", "missed"] as const),
    );
    expect(result.current[0]).toBe("all");
  });

  it("preserves unrelated query params when updating", () => {
    globalThis.window.history.replaceState(null, "", "/?other=keep");
    const { result } = renderHook(() => useUrlQueryState("status", "all"));
    act(() => {
      result.current[1]("missed");
    });
    const params = new URLSearchParams(globalThis.window.location.search);
    expect(params.get("other")).toBe("keep");
    expect(params.get("status")).toBe("missed");
  });
});
