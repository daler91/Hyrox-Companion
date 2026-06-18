import { describe, expect, it } from "vitest";

import {
  expandQuery,
  isRelevantMatch,
  rankByRelevance,
  relevanceScore,
  stem,
  tokenize,
} from "./relevance";

const food = (name: string, brand: string | null = null) => ({ name, brand });

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics, dropping empties", () => {
    expect(tokenize("Greek Yoghurt 0%!")).toEqual(["greek", "yoghurt", "0"]);
  });

  it("is empty for blank / punctuation-only input", () => {
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("--")).toEqual([]);
  });

  it("strips diacritics so accented text matches its ASCII form", () => {
    expect(tokenize("Café Latté")).toEqual(["cafe", "latte"]);
    expect(tokenize("jalapeño")).toEqual(["jalapeno"]);
  });
});

describe("stem", () => {
  it("normalizes common plurals", () => {
    expect(stem("oats")).toBe("oat");
    expect(stem("berries")).toBe("berry");
    expect(stem("peaches")).toBe("peach");
    expect(stem("boxes")).toBe("box");
    expect(stem("tomatoes")).toBe("tomato"); // -oes, else it would overshoot to "tomatoe"
    expect(stem("mangoes")).toBe("mango");
    expect(stem("cheeses")).toBe("cheese"); // -ses keeps the "-se" singular, not "chees"
    expect(stem("houses")).toBe("house");
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
    // Plural query → singular food name (the -oes case): "tomatoes" must match "Tomato".
    expect(relevanceScore("tomatoes", food("Tomato, raw"))).toBeGreaterThanOrEqual(2);
    // -ses plural whose singular ends in "-se": "cheeses" must match "Cheese".
    expect(relevanceScore("cheeses", food("Cheese, cheddar"))).toBeGreaterThanOrEqual(2);
  });

  it("does not let a shortened plural stem prefix-match an unrelated word", () => {
    // "peas" stems to "pea"; that must NOT match "Peanut" (stem equality, not prefix)...
    expect(relevanceScore("peas", food("Peanut Butter"))).toBe(0);
    // ...while a genuine plural/singular pair still matches.
    expect(relevanceScore("peas", food("Pea Protein"))).toBeGreaterThanOrEqual(2);
  });

  it("matches regional/spelling synonyms and accented names", () => {
    expect(relevanceScore("courgette", food("Zucchini Noodles"))).toBeGreaterThanOrEqual(2);
    expect(relevanceScore("cilantro", food("Fresh Coriander"))).toBeGreaterThanOrEqual(2);
    expect(relevanceScore("cafe", food("Café Mocha"))).toBeGreaterThanOrEqual(2);
  });

  it("gives a fuzzy local hit a fractional score below any real match", () => {
    // "yoghrt" is a typo (not a registered synonym) → no token match; only _localSim ranks it.
    const score = relevanceScore("yoghrt", { name: "Yogurt", brand: null, _localSim: 0.6 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
    expect(score).toBeCloseTo(0.74); // 0.5 + 0.4 * 0.6
    // Below the similarity threshold → earns nothing.
    expect(relevanceScore("yoghrt", { name: "Yogurt", brand: null, _localSim: 0.1 })).toBe(0);
  });
});

describe("isRelevantMatch", () => {
  it("is true at the gate floor and false below it", () => {
    expect(isRelevantMatch("dole", food("Banana", "Dole"))).toBe(true); // brand match (score 1)
    expect(isRelevantMatch("chip", food("Chocolate"))).toBe(false);
    expect(isRelevantMatch("ogurt", food("Yogurt"))).toBe(false); // mid-word, not a prefix
  });

  it("passes synonyms but keeps fuzzy hits below the gate", () => {
    expect(isRelevantMatch("yoghurt", food("Greek Yogurt"))).toBe(true); // synonym → score ≥ 1
    expect(isRelevantMatch("yoghrt", { name: "Yogurt", brand: null, _localSim: 0.6 })).toBe(false);
  });
});

describe("expandQuery", () => {
  it("adds synonym variants, keeping the verbatim query first", () => {
    const variants = expandQuery("courgette");
    expect(variants[0]).toBe("courgette");
    expect(variants).toContain("zucchini");
  });

  it("substitutes a synonym token within a phrase", () => {
    const variants = expandQuery("organic courgette");
    expect(variants).toContain("organic courgette");
    expect(variants).toContain("organic zucchini");
  });

  it("returns just the normalized query when no token has a synonym", () => {
    expect(expandQuery("banana")).toEqual(["banana"]);
  });

  it("is empty for blank input", () => {
    expect(expandQuery("   ")).toEqual([]);
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

  it("ranks fuzzy local hits by similarity, above non-matches", () => {
    // "yoghrt" is a typo (not a synonym), so none get a token match — only trigram
    // similarity (_localSim) ranks them; the item with no similarity sorts last.
    const items = [
      { name: "Unrelated Snack", brand: null },
      { name: "Yoghurt Low Fat", brand: null, _localSim: 0.5 }, // ~0.70
      { name: "Yogurt", brand: null, _localSim: 0.8 }, // ~0.82
    ];
    expect(rankByRelevance("yoghrt", items).map((f) => f.name)).toEqual([
      "Yogurt",
      "Yoghurt Low Fat",
      "Unrelated Snack",
    ]);
  });
});
