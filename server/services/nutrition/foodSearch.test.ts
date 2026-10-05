import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: { nutrition: { searchLocalFoods: vi.fn(), upsertFoods: vi.fn() } },
}));
vi.mock("./usdaClient", () => ({ searchUsdaFoods: vi.fn() }));
vi.mock("./edamamClient", () => ({ searchEdamamFoods: vi.fn() }));
vi.mock("./offClient", () => ({ searchOffFoods: vi.fn() }));
vi.mock("./refresh", () => ({ refreshStaleFoodsInBackground: vi.fn() }));
// Semantic search is mocked here: it's covered in semanticSearch.test.ts, and the
// real module transitively loads the DB/AI/vector layer. Default no-op ([]) keeps
// every existing assertion unchanged (semantic is purely additive).
vi.mock("./semanticSearch", () => ({ maybeSemanticSearch: vi.fn() }));
vi.mock("../../env", () => ({ env: { USDA_API_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchEdamamFoods } from "./edamamClient";
import { searchFoods } from "./foodSearch";
import { makeFood as food } from "./foodTestFixture";
import { searchOffFoods } from "./offClient";
import { maybeSemanticSearch } from "./semanticSearch";
import { searchUsdaFoods } from "./usdaClient";
import { PROVIDER_DEADLINE_MS } from "./utils";

const TEST_USDA_KEY = "test-key";

/** Configure (or, with undefined, unconfigure) USDA on the mocked env. */
function setUsdaKey(value: string | undefined): void {
  (env as { USDA_API_KEY?: string }).USDA_API_KEY = value;
}

const mappedUsda = {
  source: "usda" as const,
  sourceId: "1",
  name: "Banana",
  brand: null,
  servingSizeG: null,
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbPer100g: 23,
  fatPer100g: 0.3,
  fiberPer100g: 2.6,
  micros: null,
};
const mappedEdamam = { ...mappedUsda, source: "edamam" as const, sourceId: "ed1" };
const mappedOff = { ...mappedUsda, source: "off" as const, sourceId: "off1" };

describe("searchFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUsdaKey(TEST_USDA_KEY);
    // Default: Edamam unconfigured/unreached, USDA + OFF + local empty.
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([]);
    vi.mocked(maybeSemanticSearch).mockResolvedValue([]);
  });

  it("ranks Edamam ahead of USDA ahead of local, not degraded", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "local1", source: "custom", sourceId: null }),
    ]);
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [mappedEdamam], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "ed1", source: "edamam", sourceId: "ed1" })])
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["ed1", "usda1", "local1"]);
  });

  it("is not degraded when USDA returns no matches but the key is set", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
  });

  it("is not degraded when Edamam reached the API even with no matches (USDA off)", async () => {
    setUsdaKey(undefined);
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
  });

  it("flags degraded when no provider is live (cache-only)", async () => {
    setUsdaKey(undefined);
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("returns results and is not degraded when Edamam throws but USDA succeeds", async () => {
    vi.mocked(searchEdamamFoods).mockRejectedValue(new Error("edamam down"));
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("flags degraded and returns cache when USDA throws and Edamam is unconfigured", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockRejectedValue(new Error("USDA down"));

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("dedupes a food present in both the live result and local cache", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "localdup", source: "usda", sourceId: "1" }),
    ]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda1", source: "usda", sourceId: "1" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("usda1");
  });

  it("degrades to cache (no throw) when caching the live results fails", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockRejectedValue(new Error("constraint violation"));

    const result = await searchFoods("banana", "u1");
    // USDA was reached, so not degraded — but its uncacheable results are dropped,
    // leaving only the local cache. The request must not throw.
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("suppresses a cross-source brand+name near-duplicate (Edamam wins)", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [mappedEdamam], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([
        food({ id: "ed1", source: "edamam", sourceId: "ed1", brand: "Clif", name: "Clif Bar" }),
      ])
      .mockResolvedValueOnce([
        food({ id: "usda1", source: "usda", sourceId: "1", brand: "Clif", name: "Clif Bar" }),
      ]);

    const result = await searchFoods("clif", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["ed1"]); // USDA near-dup suppressed
  });

  it("ranks OFF results after USDA and before local, caching its hits", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "local1", source: "custom", sourceId: null }),
    ]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [mappedOff], reached: true });
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1" })]) // USDA cached first
      .mockResolvedValueOnce([food({ id: "off1", source: "off", sourceId: "off1" })]); // then OFF

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1", "off1", "local1"]);
  });

  it("keeps search live (not degraded) when only OFF reaches its API", async () => {
    setUsdaKey(undefined); // USDA + Edamam unconfigured
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
  });

  it("flags degraded only when OFF also fails to reach its API", async () => {
    setUsdaKey(undefined);
    vi.mocked(searchOffFoods).mockRejectedValue(new Error("off down"));
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops a USDA result that doesn't match the query, keeping the relevant one", async () => {
    vi.mocked(searchUsdaFoods).mockResolvedValue([
      mappedUsda, // "Banana"
      { ...mappedUsda, sourceId: "2", name: "Chocolate Bar" },
    ]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda-banana", source: "usda", sourceId: "1", name: "Banana" }),
      food({ id: "usda-choc", source: "usda", sourceId: "2", name: "Chocolate Bar" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["usda-banana"]);
  });

  it("drops an Edamam result that doesn't match the query", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({
      foods: [mappedEdamam, { ...mappedEdamam, sourceId: "ed2", name: "Granola Cereal" }],
      reached: true,
    });
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "ed-banana", source: "edamam", sourceId: "ed1", name: "Banana" }),
      food({ id: "ed-granola", source: "edamam", sourceId: "ed2", name: "Granola Cereal" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["ed-banana"]);
  });

  it("ranks a stronger name match above a weaker one from a higher-priority provider", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({
      foods: [{ ...mappedEdamam, name: "Banana Bread" }],
      reached: true,
    });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]); // exact "Banana"
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([
        food({ id: "ed-bread", source: "edamam", sourceId: "ed1", name: "Banana Bread" }),
      ])
      .mockResolvedValueOnce([
        food({ id: "usda-banana", source: "usda", sourceId: "1", name: "Banana" }),
      ]);

    const result = await searchFoods("banana", "u1");
    // USDA's exact "Banana" outranks Edamam's "Banana Bread" despite the lower tier.
    expect(result.results.map((f) => f.id)).toEqual(["usda-banana", "ed-bread"]);
  });

  it("falls back to ungated results when the gate would empty everything", async () => {
    vi.mocked(searchUsdaFoods).mockResolvedValue([
      { ...mappedUsda, sourceId: "9", name: "Chocolate Bar" },
    ]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda-choc", source: "usda", sourceId: "9", name: "Chocolate Bar" }),
    ]);

    // Gate("banana") drops the only (off-topic) hit and there's no local match, so
    // the fallback surfaces it rather than returning a blank screen.
    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["usda-choc"]);
  });

  it("surfaces a local fuzzy (typo) hit, ranked above unrelated cache rows", async () => {
    // "yoghrt" is a typo; local cache (ungated) returns a fuzzy hit (carrying
    // _localSim) plus an unrelated row. The fuzzy hit outranks the noise.
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "noise", source: "custom", sourceId: null, name: "Crackers" }),
      { ...food({ id: "fuzzy", source: "off", sourceId: "o1", name: "Yoghurt" }), _localSim: 0.7 },
    ]);

    const result = await searchFoods("yoghrt", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["fuzzy", "noise"]);
  });

  it("appends semantic matches as a low-priority tier when the keyword set is thin", async () => {
    // Keyword/fuzzy found nothing; semantic surfaces a conceptually related food.
    vi.mocked(maybeSemanticSearch).mockResolvedValue([
      food({ id: "sem1", source: "usda", sourceId: "s1", name: "Grilled Chicken Breast" }),
    ]);

    const result = await searchFoods("post workout protein", "u1");

    // Called with the thin merged count (0 here) so it knows to fire.
    expect(maybeSemanticSearch).toHaveBeenCalledWith("post workout protein", "u1", 0);
    expect(result.results.map((f) => f.id)).toEqual(["sem1"]);
  });

  it("dedupes a semantic match that's already a keyword hit (keyword copy wins)", async () => {
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda1", source: "usda", sourceId: "1", name: "Banana" }),
    ]);
    // Semantic returns the same source:sourceId — it must collapse, not double up.
    vi.mocked(maybeSemanticSearch).mockResolvedValue([
      food({ id: "sem-dup", source: "usda", sourceId: "1", name: "Banana" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["usda1"]);
  });
});

describe("searchFoods provider fan-out gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUsdaKey(TEST_USDA_KEY);
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(maybeSemanticSearch).mockResolvedValue([]);
  });

  // Distinct unbranded names: labelKey dedupe never collapses brandless foods,
  // so all 10 local hits survive to the result list.
  const richLocal = Array.from({ length: 10 }, (_, i) =>
    food({ id: `l${i}`, source: "custom", sourceId: null, name: `Banana ${i}` }),
  );

  it("skips the provider fan-out and caching entirely when the local cache is rich", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue(richLocal);

    const result = await searchFoods("banana", "u1");

    expect(searchEdamamFoods).not.toHaveBeenCalled();
    expect(searchUsdaFoods).not.toHaveBeenCalled();
    expect(searchOffFoods).not.toHaveBeenCalled();
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    // A deliberately skipped fan-out is a healthy fast path, never "degraded".
    expect(result.apiDegraded).toBe(false);
    expect(result.results).toHaveLength(10);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ providersSkipped: true }),
      expect.any(String),
    );
  });

  it("still fans out at one below the floor", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue(richLocal.slice(0, 9));
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda1", source: "usda", sourceId: "1" }),
    ]);

    const result = await searchFoods("banana", "u1");

    // Each provider gets the query and the request's deadline signal (D13).
    for (const call of [
      vi.mocked(searchEdamamFoods).mock.calls.at(0),
      vi.mocked(searchUsdaFoods).mock.calls.at(0),
      vi.mocked(searchOffFoods).mock.calls.at(0),
    ]) {
      expect(call?.[0]).toBe("banana");
      expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([mappedUsda]);
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toContain("usda1");
  });
});

// D13 (CODEBASE_ANALYSIS_2026-10-03): search waited on every provider with no
// overall deadline, so one hanging provider outlasted the client's 15 s timeout.
describe("searchFoods provider deadline", () => {
  /** A provider call that never answers on its own, only to its abort signal. */
  function hangUntilAborted(opts?: { signal?: AbortSignal }): Promise<never> {
    return new Promise((_, reject) => {
      opts?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setUsdaKey(TEST_USDA_KEY);
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(maybeSemanticSearch).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers cache-only with apiDegraded once every provider hangs past the deadline", async () => {
    let edamamSignal: AbortSignal | undefined;
    vi.mocked(searchEdamamFoods).mockImplementation((_q, opts) => {
      edamamSignal = opts?.signal;
      return hangUntilAborted(opts);
    });
    vi.mocked(searchUsdaFoods).mockImplementation((_q, opts) => hangUntilAborted(opts));
    vi.mocked(searchOffFoods).mockImplementation((_q, opts) => hangUntilAborted(opts));

    const pending = searchFoods("banana", "u1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    // The calls are told to stop, with a plain AbortError that is never retried.
    expect(edamamSignal?.aborted).toBe(true);
    expect((edamamSignal?.reason as DOMException).name).toBe("AbortError");
  });

  it("keeps the providers that answered when one never does", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    // A provider that ignores its signal entirely still cannot hold the search.
    vi.mocked(searchOffFoods).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda1", source: "usda", sourceId: "1" }),
    ]);

    const pending = searchFoods("banana", "u1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toContain("usda1");
  });
});

// D13 (CODEBASE_ANALYSIS_2026-10-03): with NUTRITION_SEMANTIC_ENABLED on, the
// semantic fallback ran after the providers' deadline with no bound of its own.
describe("searchFoods semantic fallback deadline", () => {
  /** Settles `ms` after it is called, on the (fake) timers. */
  function after<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(value);
      }, ms);
    });
  }

  /** Start a search and report whether it has settled yet. */
  function track(promise: Promise<unknown>): { settled: () => boolean } {
    let done = false;
    promise.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    return { settled: () => done };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setUsdaKey(TEST_USDA_KEY);
    // A thin keyword set (one local hit), so the semantic fallback fires.
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers with the keyword results when the semantic search hangs", async () => {
    vi.mocked(maybeSemanticSearch).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    const pending = searchFoods("protein", "u1");
    const search = track(pending);
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);

    expect(search.settled()).toBe(true);
    const result = await pending;
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(result.apiDegraded).toBe(false);
  });

  it("shares the providers' deadline instead of starting a fresh one", async () => {
    // The providers use most of the budget; the semantic search gets the rest.
    vi.mocked(searchOffFoods).mockReturnValue(
      after(PROVIDER_DEADLINE_MS - 1_000, { foods: [], reached: true }),
    );
    vi.mocked(maybeSemanticSearch).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    const search = track(searchFoods("protein", "u1"));
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);

    expect(maybeSemanticSearch).toHaveBeenCalledOnce();
    expect(search.settled()).toBe(true);
  });

  it("skips the semantic search once the providers used up the deadline", async () => {
    vi.mocked(searchOffFoods).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );
    vi.mocked(maybeSemanticSearch).mockResolvedValue([]);

    const pending = searchFoods("protein", "u1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(maybeSemanticSearch).not.toHaveBeenCalled();
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
  });
});
