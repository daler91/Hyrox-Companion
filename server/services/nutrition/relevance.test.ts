import { describe, expect, it } from "vitest";

import { isRelevantMatch, rankByRelevance, relevanceScore, stem, tokenize } from "./relevance";

const food = (name: string, brand: string | null = null) => ({ name, brand });

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics, dropping empties", () => {
    expect(tokenize("Greek Yoghurt 0%!")).toEqual(["greek", "yoghurt", "0"]);
  });

  it("is empty for blank / punctuation-only input", () => {
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("--")).toEqual([]);
  });
});

describe("stem", () => {
  it("normalizes common plurals", () => {
    expect(stem("oats")).toBe("oat");
    expect(stem("berries")).toBe("berry");
    expect(stem("peaches")).toBe("peach");
    expect(stem("boxes")).toBe("box");
  });

  it("leaves non-plurals and short tokens unchanged", () => {
    expect(stem("glass")).toBe("glass"); // -ss is not a plural
    expect(stem("oatmeal")).toBe("oatmeal");
    expect(stem("gas")).toBe("gas"); // too short to strip
  });
});

describe("relevanceScore", () => {
  it("scores an exact name match highest (4)", () => {
    expect(relevanceScore("banana", food("Banana"))).toBe(4);
    expect(relevanceScore("greek yogurt", food("Greek Yogurt"))).toBe(4);
  });

  it("scores a full-query name prefix as 3", () => {
    expect(relevanceScore("greek yogurt", food("Greek Yogurt 0% Fat"))).toBe(3);
  });

  it("scores an all-tokens name match as 2", () => {
    expect(relevanceScore("choc", food("Chocolate Bar"))).toBe(2);
  });

  it("scores a brand-only match as 1 (the gate floor)", () => {
    expect(relevanceScore("dole", food("Banana", "Dole"))).toBe(1);
  });

  it("scores an unrelated food 0", () => {
    expect(relevanceScore("chip", food("Chocolate"))).toBe(0);
    expect(relevanceScore("banana split", food("Banana"))).toBe(0);
    expect(relevanceScore("   ", food("Banana"))).toBe(0);
  });

  it("matches across singular/plural via stemming (the morphology fix)", () => {
    expect(relevanceScore("berries", food("Berry Mix"))).toBeGreaterThanOrEqual(2);
    expect(relevanceScore("oats", food("Rolled Oat"))).toBeGreaterThanOrEqual(2);
    expect(relevanceScore("tomato", food("Tomatoes, red, ripe"))).toBeGreaterThanOrEqual(2);
  });
});

describe("isRelevantMatch", () => {
  it("is true at the gate floor and false below it", () => {
    expect(isRelevantMatch("dole", food("Banana", "Dole"))).toBe(true); // brand match (score 1)
    expect(isRelevantMatch("chip", food("Chocolate"))).toBe(false);
    expect(isRelevantMatch("ogurt", food("Yogurt"))).toBe(false); // mid-word, not a prefix
  });
});

describe("rankByRelevance", () => {
  it("orders better matches first and is stable on ties", () => {
    const items = [
      food("Banana Bread"), // 3 (name starts with the query)
      food("Banana"), // 4 (exact)
      food("Strawberry Banana Smoothie"), // 2 (token match, not a prefix)
      food("Organic Banana Chips"), // 2 (token match, not a prefix)
    ];
    const ranked = rankByRelevance("banana", items).map((f) => f.name);
    // 4 then 3 promoted ahead; the two equal-score (2) items keep their input order.
    expect(ranked).toEqual([
      "Banana",
      "Banana Bread",
      "Strawberry Banana Smoothie",
      "Organic Banana Chips",
    ]);
  });

  it("promotes an exact match ahead of an earlier weaker match across providers", () => {
    // Simulates an Edamam (earlier) weak hit vs a USDA (later) exact hit.
    const items = [food("Banana Nut Cereal"), food("Banana")];
    expect(rankByRelevance("banana", items).map((f) => f.name)).toEqual([
      "Banana",
      "Banana Nut Cereal",
    ]);
  });
});
