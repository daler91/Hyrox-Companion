import { beforeEach, describe, expect, it, vi } from "vitest";

// `query`/`selectWhere`/`selectLimit`/`candidateWhere`/`candidateOrderBy` are
// referenced inside the hoisted vi.mock factories below, so they must be
// created via vi.hoisted to exist before the module graph is evaluated.
// `selectWhere` resolves the main-DB db.select(...).from(...).where(...) chain
// used by the prune sweep; `candidateWhere`, `candidateOrderBy` and
// `selectLimit` resolve the
// db.select(...).from(...).leftJoin(...).where(...).orderBy(...).limit(...)
// chain used by the embed backfill's candidate scan.
const { query, selectWhere, selectLimit, candidateWhere, candidateOrderBy } = vi.hoisted(() => {
  const limit = vi.fn();
  const orderBy = vi.fn(() => ({ limit }));
  return {
    query: vi.fn(),
    selectWhere: vi.fn(),
    selectLimit: limit,
    candidateOrderBy: orderBy,
    candidateWhere: vi.fn(() => ({ orderBy })),
  };
});

// Stub the I/O-heavy imports so the module loads without real DB / AI / vector infra.
vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: selectWhere, leftJoin: () => ({ where: candidateWhere }) }),
    }),
  },
}));
vi.mock("../../vectorDb", () => ({ vectorPool: { query } }));
vi.mock("../../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072, generateEmbeddings: vi.fn() }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { generateEmbeddings } from "../../gemini/client";
import {
  __resetFoodEmbeddingScanForTests,
  deleteFoodEmbeddingsByFoodIds,
  embedMissingFoods,
  foodEmbeddingText,
  pruneDanglingFoodEmbeddings,
  selectFoodsToEmbed,
  textHash,
} from "./foodEmbeddings";

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

describe("deleteFoodEmbeddingsByFoodIds", () => {
  beforeEach(() => query.mockClear());

  it("purges the given food ids from the vector DB (account erasure, GDPR Art. 17)", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 2 });

    await deleteFoodEmbeddingsByFoodIds(["food-a", "food-b"]);

    // Must run against vectorPool — the main-DB cascade cannot reach the
    // separate vector database, and food_embeddings has no user column.
    expect(query).toHaveBeenCalledWith(`DELETE FROM food_embeddings WHERE food_id = ANY($1)`, [
      ["food-a", "food-b"],
    ]);
  });

  it("is a no-op for an empty id list", async () => {
    await deleteFoodEmbeddingsByFoodIds([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("pruneDanglingFoodEmbeddings", () => {
  beforeEach(() => {
    query.mockClear();
    selectWhere.mockClear();
  });

  it("deletes embeddings whose foods row no longer exists", async () => {
    query.mockResolvedValueOnce({
      rows: [{ food_id: "live-1" }, { food_id: "gone-1" }, { food_id: "gone-2" }],
    });
    selectWhere.mockResolvedValueOnce([{ id: "live-1" }]);
    query.mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const result = await pruneDanglingFoodEmbeddings();

    expect(result).toEqual({ pruned: 2 });
    expect(query).toHaveBeenLastCalledWith(`DELETE FROM food_embeddings WHERE food_id = ANY($1)`, [
      ["gone-1", "gone-2"],
    ]);
  });

  it("is a no-op when every embedding still has a foods row", async () => {
    query.mockResolvedValueOnce({ rows: [{ food_id: "live-1" }] });
    selectWhere.mockResolvedValueOnce([{ id: "live-1" }]);

    const result = await pruneDanglingFoodEmbeddings();

    expect(result).toEqual({ pruned: 0 });
    expect(query).toHaveBeenCalledTimes(1); // only the SELECT, no DELETE
  });

  it("is a no-op when the embeddings table is empty", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await pruneDanglingFoodEmbeddings();

    expect(result).toEqual({ pruned: 0 });
    expect(selectWhere).not.toHaveBeenCalled();
  });
});

describe("embedMissingFoods", () => {
  beforeEach(() => {
    query.mockClear();
    selectLimit.mockReset();
    candidateWhere.mockClear();
    candidateOrderBy.mockClear();
    vi.mocked(generateEmbeddings).mockReset();
    __resetFoodEmbeddingScanForTests();
  });

  it("is a no-op when there are no candidates pending embedding", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // existing food_id/text_hash pairs
    selectLimit.mockResolvedValueOnce([]); // no candidate foods

    const result = await embedMissingFoods();

    expect(result).toEqual({ embedded: 0 });
    expect(generateEmbeddings).not.toHaveBeenCalled();
    // Only the existing-hashes SELECT ran — no INSERT was attempted.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("upserts every embedded food in a single multi-row query", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no existing hashes — both are pending
    selectLimit.mockResolvedValueOnce([
      { id: "a", name: "Banana", brand: null },
      { id: "b", name: "Apple", brand: null },
    ]);
    vi.mocked(generateEmbeddings).mockResolvedValueOnce([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    query.mockResolvedValueOnce({ rows: [] }); // the batch INSERT

    const result = await embedMissingFoods();

    expect(result).toEqual({ embedded: 2 });
    // One round trip for both rows, not one INSERT per food.
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain(
      "VALUES ($1, $2::vector(3072), $3, $4, now()), ($5, $6::vector(3072), $7, $8, now())",
    );
    expect(params).toEqual([
      "a",
      "[1,2,3]",
      "gemini-embedding-001",
      textHash("Banana"),
      "b",
      "[4,5,6]",
      "gemini-embedding-001",
      textHash("Apple"),
    ]);
  });

  it("skips a food whose generated vector came back empty, counting only the rest", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    selectLimit.mockResolvedValueOnce([
      { id: "a", name: "Banana", brand: null },
      { id: "b", name: "Apple", brand: null },
    ]);
    // 'a' failed to embed (empty vector); only 'b' should reach the upsert.
    vi.mocked(generateEmbeddings).mockResolvedValueOnce([[], [4, 5, 6]]);
    query.mockResolvedValueOnce({ rows: [] });

    const result = await embedMissingFoods();

    expect(result).toEqual({ embedded: 1 });
    const [, params] = query.mock.calls[1];
    expect(params).toEqual(["b", "[4,5,6]", "gemini-embedding-001", textHash("Apple")]);
  });

  it("skips the upsert entirely when every generated vector is empty", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    selectLimit.mockResolvedValueOnce([{ id: "a", name: "Banana", brand: null }]);
    vi.mocked(generateEmbeddings).mockResolvedValueOnce([[]]);

    const result = await embedMissingFoods();

    expect(result).toEqual({ embedded: 0 });
    // Only the existing-hashes SELECT ran — no INSERT for an empty row set.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("scans only foods it may send to the provider: shared rows, or a private custom food whose owner consents (P14)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    selectLimit.mockResolvedValueOnce([]);
    candidateWhere.mockClear();

    await embedMissingFoods();

    const [predicate] = candidateWhere.mock.calls.at(0) as unknown as [SQL];
    const rendered = new PgDialect().sqlToQuery(predicate);
    expect(rendered.sql).toContain('"foods"."source" <> $1');
    expect(rendered.sql).toContain('"foods"."is_public" = $2');
    expect(rendered.sql).toContain('"users"."ai_coach_enabled" = $3');
    expect(rendered.sql).toContain(" or ");
    expect(rendered.params).toEqual(["custom", true, true]);
  });
});

describe("embedMissingFoods candidate scan order (PF12)", () => {
  const dialect = new PgDialect();
  const PAGE_SIZE = 5000;

  /** A full page of foods named after their ids, in id order. */
  function fullPage(pageIndex: number): { id: string; name: string; brand: null }[] {
    return [...Array(PAGE_SIZE).keys()].map((offset) => {
      const id = `p${pageIndex}-${String(offset).padStart(5, "0")}`;
      return { id, name: `Food ${id}`, brand: null };
    });
  }

  /** The vector DB already holds a current embedding for every food given. */
  function embeddedAlready(rows: readonly { id: string; name: string }[]) {
    return { rows: rows.map((row) => ({ food_id: row.id, text_hash: textHash(row.name) })) };
  }

  /** The candidate predicate of the nth page query, rendered. */
  function pageQuery(callIndex: number): { sql: string; params: unknown[] } {
    const [predicate] = candidateWhere.mock.calls.at(callIndex) as unknown as [SQL];
    return dialect.sqlToQuery(predicate);
  }

  beforeEach(() => {
    query.mockReset();
    selectLimit.mockReset();
    candidateWhere.mockClear();
    candidateOrderBy.mockClear();
    vi.mocked(generateEmbeddings).mockReset();
    __resetFoodEmbeddingScanForTests();
  });

  it("reads foods in id order, and the next run resumes after the last food it picked", async () => {
    const banana = { id: "a", name: "Banana", brand: null };
    const apple = { id: "b", name: "Apple", brand: null };
    query.mockResolvedValue({ rows: [] });
    selectLimit.mockResolvedValueOnce([banana, apple]).mockResolvedValueOnce([apple]);
    vi.mocked(generateEmbeddings).mockResolvedValue([[1, 2, 3]]);

    await embedMissingFoods(1);
    await embedMissingFoods(1);

    const [ordering] = candidateOrderBy.mock.calls.at(0) as unknown as [SQL];
    expect(dialect.sqlToQuery(ordering).sql).toBe('"foods"."id" asc');
    expect(selectLimit).toHaveBeenCalledWith(PAGE_SIZE);
    expect(pageQuery(0).sql).not.toContain('"foods"."id" >');
    // The second run starts after "a" instead of re-reading it.
    expect(pageQuery(1).sql).toContain('"foods"."id" > $4');
    expect(pageQuery(1).params).toEqual(["custom", true, true, "a"]);
    expect(vi.mocked(generateEmbeddings).mock.calls).toEqual([[["Banana"]], [["Apple"]]]);
  });

  it("pages past foods that are already embedded to reach the ones that are not", async () => {
    const first = fullPage(1);
    const late = { id: "q-late", name: "Late cached oats", brand: null };
    query.mockResolvedValueOnce(embeddedAlready(first)).mockResolvedValueOnce({ rows: [] });
    selectLimit.mockResolvedValueOnce(first).mockResolvedValueOnce([late]);
    vi.mocked(generateEmbeddings).mockResolvedValueOnce([[1, 2, 3]]);

    const result = await embedMissingFoods();

    expect(result).toEqual({ embedded: 1 });
    expect(vi.mocked(generateEmbeddings)).toHaveBeenCalledWith(["Late cached oats"]);
    expect(pageQuery(1).params.at(-1)).toBe(first.at(-1)?.id);
  });

  it("reads at most four pages a run, and the next run carries on from there", async () => {
    const pages = [1, 2, 3, 4].map((pageIndex) => fullPage(pageIndex));
    query.mockResolvedValue(embeddedAlready(pages.flat()));
    for (const page of pages) selectLimit.mockResolvedValueOnce(page);
    selectLimit.mockResolvedValueOnce([]);

    expect(await embedMissingFoods()).toEqual({ embedded: 0 });
    expect(selectLimit).toHaveBeenCalledTimes(4);

    await embedMissingFoods();

    expect(pageQuery(4).params.at(-1)).toBe(pages.at(-1)?.at(-1)?.id);
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("starts again from the lowest id once a run reaches the end of the table", async () => {
    const banana = { id: "a", name: "Banana", brand: null };
    query.mockResolvedValue(embeddedAlready([banana]));
    selectLimit.mockResolvedValue([banana]);

    await embedMissingFoods();
    await embedMissingFoods();

    expect(pageQuery(1).sql).not.toContain('"foods"."id" >');
    expect(pageQuery(1).params).toEqual(["custom", true, true]);
  });

  it("keeps its place when the provider fails, so the same foods are tried next run", async () => {
    const banana = { id: "a", name: "Banana", brand: null };
    query.mockResolvedValue({ rows: [] });
    selectLimit.mockResolvedValue([banana, { id: "b", name: "Apple", brand: null }]);
    vi.mocked(generateEmbeddings).mockRejectedValueOnce(new Error("provider down"));

    await expect(embedMissingFoods(1)).rejects.toThrow("provider down");
    vi.mocked(generateEmbeddings).mockResolvedValueOnce([[1, 2, 3]]);
    await embedMissingFoods(1);

    expect(pageQuery(1).params).toEqual(["custom", true, true]);
    expect(vi.mocked(generateEmbeddings).mock.calls.at(1)).toEqual([["Banana"]]);
  });
});
