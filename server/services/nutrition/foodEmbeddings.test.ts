import { describe, expect, it, vi } from "vitest";

// Stub the I/O-heavy imports so the module loads without real DB / AI / vector infra;
// only the pure helpers are exercised here.
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../vectorDb", () => ({ vectorPool: {} }));
vi.mock("../../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072, generateEmbeddings: vi.fn() }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { foodEmbeddingText, selectFoodsToEmbed, textHash } from "./foodEmbeddings";

describe("foodEmbeddingText", () => {
  it("joins name and brand, trimming", () => {
    expect(foodEmbeddingText({ name: "Banana", brand: null })).toBe("Banana");
    expect(foodEmbeddingText({ name: "Greek Yogurt", brand: "Chobani" })).toBe(
      "Greek Yogurt Chobani",
    );
  });
});

describe("textHash", () => {
  it("is deterministic and varies with the text", () => {
    expect(textHash("Banana")).toBe(textHash("Banana"));
    expect(textHash("Banana")).not.toBe(textHash("Banana Dole"));
    expect(textHash("Banana")).toHaveLength(32);
  });
});

describe("selectFoodsToEmbed", () => {
  const foods = [
    { id: "a", name: "Banana", brand: null },
    { id: "b", name: "Apple", brand: null },
    { id: "c", name: "", brand: null }, // no embeddable text
  ];

  it("selects foods missing or stale, skipping current and empty-text ones", () => {
    const existing = new Map([["a", textHash("Banana")]]); // 'a' is current
    const pending = selectFoodsToEmbed(foods, existing, 10);
    // 'a' skipped (hash matches), 'c' skipped (empty text), only 'b' selected.
    expect(pending.map((p) => p.id)).toEqual(["b"]);
    expect(pending[0]).toMatchObject({ id: "b", text: "Apple", hash: textHash("Apple") });
  });

  it("re-selects a food whose text changed (stale hash)", () => {
    const existing = new Map([["a", "stale-hash"]]);
    expect(selectFoodsToEmbed(foods, existing, 10).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("respects the batch limit", () => {
    expect(selectFoodsToEmbed(foods, new Map(), 1).map((p) => p.id)).toEqual(["a"]);
  });
});
