import { describe, expect, it } from "vitest";
import { parseCursorPagination, parseOffsetPagination } from "./index";

describe("pagination parsers", () => {
  it("clamps max limit for deep pages", () => {
    const result = parseOffsetPagination({ limit: "999", offset: "10000" }, { maxLimit: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(100);
      expect(result.value.offset).toBe(10000);
    }
  });

  it("returns validation error for invalid cursor", () => {
    const result = parseCursorPagination({ cursor: "   " });
    expect(result).toEqual({ ok: false, error: { code: "BAD_REQUEST", error: "Invalid cursor" } });
  });

  it("returns empty-page metadata behavior inputs", () => {
    const result = parseOffsetPagination({ limit: "25", offset: "99999" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.offset).toBe(99999);
  });
});
