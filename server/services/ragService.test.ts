import type { CoachingMaterial } from "@shared/schema";
import { afterEach, beforeEach,describe, expect, it, vi } from "vitest";

import { chunkText, embedCoachingMaterial, EMBEDDING_UNAVAILABLE_MESSAGE, getRagStatus, retrieveRelevantChunks } from "./ragService";

// Mock dependencies
vi.mock("../gemini/client", () => ({
  EMBEDDING_DIMENSIONS: 3072,
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  trackEmbeddingUsage: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    coaching: {
      deleteChunksByMaterialId: vi.fn(),
      getCoachingMaterial: vi.fn(),
      replaceChunks: vi.fn(),
      searchChunksByEmbedding: vi.fn(),
      listPrincipleMaterialIds: vi.fn(),
      listChunksForMaterials: vi.fn(),
      getMaterialTitles: vi.fn(),
      listCoachingMaterials: vi.fn(),
      getChunkCountsByMaterial: vi.fn(),
      getStoredEmbeddingDimension: vi.fn(),
    },
  },
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { env } from "../env";
import { generateEmbedding, generateEmbeddings } from "../gemini/client";
import { logger } from "../logger";
import { storage } from "../storage";

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe("chunkText", () => {
  it("should return empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("should return single chunk for short text", () => {
    const text = "Short text.";
    const chunks = chunkText(text);
    expect(chunks).toEqual(["Short text."]);
  });

  it("should handle text at chunk size (may overlap)", () => {
    const text = "a".repeat(600);
    const chunks = chunkText(text);
    // All text should be covered
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].length).toBeGreaterThan(0);
  });

  it("should split long text into multiple chunks", () => {
    const text = "a".repeat(1500);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should create overlapping chunks", () => {
    // With 600 char chunks and 100 char overlap, text of 1000 chars
    // should produce chunks where content overlaps
    const text = "word ".repeat(200); // 1000 chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: end of first chunk should appear at start of second
    const firstEnd = chunks[0].slice(-50);
    expect(chunks[1]).toContain(firstEnd);
  });

  it("should prefer paragraph boundaries for splitting", () => {
    // Create text with a paragraph break in the preferred zone (>50% of chunk size)
    const before = "a".repeat(400);
    const after = "b".repeat(400);
    const text = `${before}\n\n${after}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end at the paragraph boundary
    expect(chunks[0].trim()).toBe(before);
  });

  it("should prefer sentence boundaries when no paragraph break is found", () => {
    const before = "a".repeat(400);
    const after = "b".repeat(400);
    const text = `${before}. ${after}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end at the sentence boundary (including period)
    expect(chunks[0].trim()).toBe(`${before}.`);
  });

  it("should not produce empty chunks", () => {
    const text = "hello\n\n\n\nworld\n\n\n\n" + "x".repeat(700);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("should always make forward progress (no infinite loop)", () => {
    // Single long word with no natural breaks
    const text = "a".repeat(2000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Should eventually consume all text
    const totalContent = chunks.join("");
    expect(totalContent.length).toBeGreaterThanOrEqual(text.length);
  });
});

// ---------------------------------------------------------------------------
// embedCoachingMaterial
// ---------------------------------------------------------------------------

describe("embedCoachingMaterial", () => {
  const mockMaterial: CoachingMaterial = {
    id: "mat_1",
    userId: "user_1",
    title: "Training Guide",
    content: "Short content for testing.",
    type: "document",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so implementations set by one test
    // cannot leak into the next under shuffled execution order.
    vi.resetAllMocks();
    // Default: the material still exists once its chunks are written.
    vi.mocked(storage.coaching.getCoachingMaterial).mockResolvedValue(mockMaterial);
  });

  it("should replace existing chunks with new ones", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1, 0.2]]);
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);

    await embedCoachingMaterial(mockMaterial);

    expect(storage.coaching.replaceChunks).toHaveBeenCalledWith("mat_1", [
      {
        materialId: "mat_1",
        userId: "user_1",
        content: "Short content for testing.",
        chunkIndex: 0,
        embedding: [0.1, 0.2],
      },
    ]);
  });

  it("should prefix first chunk with material title", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1]]);
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);

    await embedCoachingMaterial(mockMaterial);

    // generateEmbeddings should receive the title-prefixed text
    const call = vi.mocked(generateEmbeddings).mock.calls[0][0];
    expect(call[0]).toBe("Training Guide: Short content for testing.");
  });

  it("should skip everything when content is empty", async () => {
    const emptyMaterial = { ...mockMaterial, content: "" };

    await embedCoachingMaterial(emptyMaterial);

    expect(storage.coaching.replaceChunks).not.toHaveBeenCalled();
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });

  it("should handle multiple chunks with correct indices", async () => {
    const longContent = "a".repeat(1500);
    const longMaterial = { ...mockMaterial, content: longContent };

    // Mock embeddings for however many chunks are generated
    vi.mocked(generateEmbeddings).mockImplementation(async (texts) =>
      texts.map(() => [0.5]),
    );
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);

    await embedCoachingMaterial(longMaterial);

    const insertedChunks = vi.mocked(storage.coaching.replaceChunks).mock.calls[0][1];
    expect(insertedChunks.length).toBeGreaterThan(1);
    // Verify indices are sequential
    insertedChunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.materialId).toBe("mat_1");
      expect(chunk.userId).toBe("user_1");
    });
  });

  it("de-duplicates identical chunk texts before embedding (S7)", async () => {
    // Pure repeated content produces identical interior chunks (same-size slices),
    // so dedup should embed each distinct text once and reuse the vector.
    const repetitiveMaterial = { ...mockMaterial, content: "a".repeat(3000) };
    vi.mocked(generateEmbeddings).mockImplementation(async (texts) => texts.map((t) => [t.length]));
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);

    await embedCoachingMaterial(repetitiveMaterial);

    const passedTexts = vi.mocked(generateEmbeddings).mock.calls[0][0];
    const insertedChunks = vi.mocked(storage.coaching.replaceChunks).mock.calls[0][1];

    // Only unique texts are embedded, but every chunk still gets an embedding.
    expect(new Set(passedTexts).size).toBe(passedTexts.length);
    expect(passedTexts.length).toBeLessThan(insertedChunks.length);
    insertedChunks.forEach((chunk) => expect(chunk.embedding).toBeDefined());

    // Identical-content chunks reuse the same vector (size-agnostic check).
    // Skip chunk 0: it's embedded with a title prefix, so its embedding text
    // differs from same-content interior chunks by design.
    const interior = insertedChunks.slice(1);
    const byContent = new Map<string, typeof interior>();
    for (const chunk of interior) {
      byContent.set(chunk.content, [...(byContent.get(chunk.content) ?? []), chunk]);
    }
    const repeated = [...byContent.values()].find((list) => list.length > 1);
    expect(repeated).toBeDefined();
    for (const chunk of repeated!) {
      expect(chunk.embedding).toEqual(repeated![0].embedding);
    }
  });

  it("should throw when embedding fails (callers handle errors)", async () => {
    vi.mocked(generateEmbeddings).mockRejectedValue(new Error("API error"));

    await expect(embedCoachingMaterial(mockMaterial)).rejects.toThrow("API error");
  });

  it("keeps the chunks it wrote while the material still exists (D38)", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1]]);
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);

    await embedCoachingMaterial(mockMaterial);

    expect(storage.coaching.getCoachingMaterial).toHaveBeenCalledWith("mat_1", "user_1");
    expect(storage.coaching.deleteChunksByMaterialId).not.toHaveBeenCalled();
  });

  it("purges the chunks it just wrote when the material was deleted mid-embed (D38)", async () => {
    // The delete route's inline purge ran before replaceChunks committed, so
    // only this re-check can take the re-inserted chunks back out.
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1]]);
    vi.mocked(storage.coaching.replaceChunks).mockResolvedValue([]);
    // A reset mock returns nothing: the material is gone.
    vi.mocked(storage.coaching.getCoachingMaterial).mockReset();

    await embedCoachingMaterial(mockMaterial);

    expect(storage.coaching.deleteChunksByMaterialId).toHaveBeenCalledWith("mat_1", "user_1");
    const writeOrder = vi.mocked(storage.coaching.replaceChunks).mock.invocationCallOrder[0];
    const recheckOrder = vi.mocked(storage.coaching.getCoachingMaterial).mock.invocationCallOrder[0];
    const purgeOrder = vi.mocked(storage.coaching.deleteChunksByMaterialId).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(recheckOrder);
    expect(recheckOrder).toBeLessThan(purgeOrder);
  });
});

// ---------------------------------------------------------------------------
// retrieveRelevantChunks
// ---------------------------------------------------------------------------

describe("retrieveRelevantChunks", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a mockResolvedValue/mockImplementation
    // set by one test cannot leak into the next under shuffled execution order.
    vi.resetAllMocks();
    // Default: no pinned principles, so the existing cases below exercise the
    // unpinned search path unchanged.
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue([]);
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([]);
    // Default: every material the chunks name still exists.
    vi.mocked(storage.coaching.getMaterialTitles).mockImplementation((_userId, ids) =>
      Promise.resolve(new Map(ids.map((id) => [id, `Title of ${id}`]))),
    );
  });

  /** The retrieved text, without sources. */
  const contents = (chunks: Awaited<ReturnType<typeof retrieveRelevantChunks>>) => chunks.map((chunk) => chunk.content);

  it("should embed query and search for similar chunks", async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];
    vi.mocked(generateEmbedding).mockResolvedValue(queryEmbedding);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "chunk 1", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
      { id: "c2", materialId: "m1", userId: "u1", content: "chunk 2", chunkIndex: 1, embedding: null, createdAt: new Date(), distance: 0.3 },
    ]);

    const result = await retrieveRelevantChunks("u1", "how to train");

    expect(generateEmbedding).toHaveBeenCalledWith("how to train");
    expect(storage.coaching.searchChunksByEmbedding).toHaveBeenCalledWith("u1", queryEmbedding, 6);
    expect(contents(result)).toEqual(["chunk 1", "chunk 2"]);
  });

  it("should respect custom topK parameter", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([]);

    await retrieveRelevantChunks("u1", "query", 3);

    expect(storage.coaching.searchChunksByEmbedding).toHaveBeenCalledWith("u1", [0.1], 3);
  });


  it("pins the athlete's stated principles ahead of the semantic results", async () => {
    // Without the pin, "no sled at my gym" only reaches the coach when the
    // query happens to embed near it.
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue(["m-principles"]);
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([
      { id: "p1", materialId: "m-principles", userId: "u1", content: "no sled at my gym", chunkIndex: 0, embedding: null, createdAt: new Date() },
    ]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "semantic hit", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
    ]);

    const result = await retrieveRelevantChunks("u1", "pin-order query");

    expect(result[0].content).toBe("no sled at my gym");
    expect(contents(result)).toContain("semantic hit");
  });

  it("keeps the total at topK, so prompt size and cost do not change", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue(["m-principles"]);
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([
      { id: "p1", materialId: "m-principles", userId: "u1", content: "p1", chunkIndex: 0, embedding: null, createdAt: new Date() },
      { id: "p2", materialId: "m-principles", userId: "u1", content: "p2", chunkIndex: 1, embedding: null, createdAt: new Date() },
    ]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue(
      Array.from({ length: 6 }, (_v, i) => ({
        id: `c${i}`, materialId: "m1", userId: "u1", content: `c${i}`, chunkIndex: i, embedding: null, createdAt: new Date(),
        distance: 0.1 + i * 0.05,
      })),
    );

    const result = await retrieveRelevantChunks("u1", "topk-budget query");

    expect(result).toHaveLength(6);
    expect(contents(result).slice(0, 2)).toEqual(["p1", "p2"]);
  });

  it("caps the pin so a long document pasted as principles cannot crowd out the search", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue(["m-principles"]);
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([]);

    await retrieveRelevantChunks("u1", "pin-cap query");

    expect(storage.coaching.listChunksForMaterials).toHaveBeenCalledWith("u1", ["m-principles"], 3);
  });

  it("does not repeat a chunk the search also returned", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue(["m-principles"]);
    const pinnedChunk = { id: "p1", materialId: "m-principles", userId: "u1", content: "no sled", chunkIndex: 0, embedding: null, createdAt: new Date() };
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([pinnedChunk]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([{ ...pinnedChunk, distance: 0.1 }]);

    const result = await retrieveRelevantChunks("u1", "dedupe query");

    expect(contents(result)).toEqual(["no sled"]);
  });

  it("degrades to an unpinned search when the principles read fails", async () => {
    // A failure here must not take down the chat turn.
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockRejectedValue(new Error("vector db down"));
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "semantic hit", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
    ]);

    expect(contents(await retrieveRelevantChunks("u1", "degrade query"))).toEqual(["semantic hit"]);
  });

  it("drops semantic results beyond the distance cut-off, but never a pinned principle", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.listPrincipleMaterialIds).mockResolvedValue(["m-principles"]);
    vi.mocked(storage.coaching.listChunksForMaterials).mockResolvedValue([
      { id: "p1", materialId: "m-principles", userId: "u1", content: "no sled at my gym", chunkIndex: 0, embedding: null, createdAt: new Date() },
    ]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "near", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.35 },
      { id: "c2", materialId: "m1", userId: "u1", content: "unrelated", chunkIndex: 1, embedding: null, createdAt: new Date(), distance: 0.9 },
    ]);

    const result = await retrieveRelevantChunks("u1", "cut-off query");

    expect(contents(result)).toEqual(["no sled at my gym", "near"]);
  });

  it("names the material each chunk came from, scoped to the athlete", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "Short steps on the sled.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
      { id: "c2", materialId: "m2", userId: "u1", content: "Wall ball pacing.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.3 },
    ]);
    vi.mocked(storage.coaching.getMaterialTitles).mockResolvedValue(
      new Map([["m1", "Sled technique"], ["m2", "Wall balls"]]),
    );

    const result = await retrieveRelevantChunks("u1", "sources query");

    expect(storage.coaching.getMaterialTitles).toHaveBeenCalledWith("u1", ["m1", "m2"]);
    expect(result).toEqual([
      { content: "Short steps on the sled.", source: "Sled technique" },
      { content: "Wall ball pacing.", source: "Wall balls" },
    ]);
  });

  it("drops a chunk whose material no longer exists on the main DB (D38)", async () => {
    // m-deleted's chunks outlived the material on the vector DB; the coach
    // must not keep quoting a document the athlete deleted.
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m-deleted", userId: "u1", content: "Deleted text.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.1 },
      { id: "c2", materialId: "m1", userId: "u1", content: "Short steps on the sled.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
    ]);
    vi.mocked(storage.coaching.getMaterialTitles).mockResolvedValue(new Map([["m1", "Sled technique"]]));

    const result = await retrieveRelevantChunks("u1", "dangling-chunk query");

    expect(result).toEqual([{ content: "Short steps on the sled.", source: "Sled technique" }]);
  });

  it("fills the topK budget from the next live chunk when a dangling one is dropped (D38)", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m-deleted", userId: "u1", content: "Deleted text.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.1 },
      { id: "c2", materialId: "m1", userId: "u1", content: "first live", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
      { id: "c3", materialId: "m1", userId: "u1", content: "second live", chunkIndex: 1, embedding: null, createdAt: new Date(), distance: 0.3 },
    ]);
    vi.mocked(storage.coaching.getMaterialTitles).mockResolvedValue(new Map([["m1", "Sled technique"]]));

    const result = await retrieveRelevantChunks("u1", "dangling-topk query", 2);

    expect(contents(result)).toEqual(["first live", "second live"]);
  });

  it("still returns the chunks, uncited, when the titles read fails", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.coaching.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "Short steps on the sled.", chunkIndex: 0, embedding: null, createdAt: new Date(), distance: 0.2 },
    ]);
    vi.mocked(storage.coaching.getMaterialTitles).mockRejectedValue(new Error("db down"));

    expect(await retrieveRelevantChunks("u1", "titles-fail query")).toEqual([{ content: "Short steps on the sled.", source: null }]);
    // Unchecked against the main DB, so not cached: the next turn checks again.
    await retrieveRelevantChunks("u1", "titles-fail query");
    expect(storage.coaching.searchChunksByEmbedding).toHaveBeenCalledTimes(2);
  });

  it("should propagate errors to caller", async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("API down"));

    await expect(retrieveRelevantChunks("u1", "query")).rejects.toThrow("API down");
  });
});

// ---------------------------------------------------------------------------
// getRagStatus
// ---------------------------------------------------------------------------

describe("getRagStatus (S6, CODEBASE_ANALYSIS_2026-10-03)", () => {
  const originalKey = env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.coaching.listCoachingMaterials).mockResolvedValue([]);
    vi.mocked(storage.coaching.getChunkCountsByMaterial).mockResolvedValue([]);
    vi.mocked(storage.coaching.getStoredEmbeddingDimension).mockResolvedValue(null);
  });

  afterEach(() => {
    env.GEMINI_API_KEY = originalKey;
  });

  it("logs the provider error and returns only a generic message", async () => {
    env.GEMINI_API_KEY = "test-key";
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("403 PERMISSION_DENIED: API key project-123 suspended"));

    const status = await getRagStatus("user-1");

    expect(status.embeddingApi).toEqual({ ok: false, error: EMBEDDING_UNAVAILABLE_MESSAGE });
    expect(JSON.stringify(status)).not.toContain("PERMISSION_DENIED");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("health probe failed"),
    );
  });

  it("does not name the missing server key", async () => {
    env.GEMINI_API_KEY = undefined;

    const status = await getRagStatus("user-1");

    expect(status.hasApiKey).toBe(false);
    expect(status.embeddingApi).toEqual({ ok: false, error: EMBEDDING_UNAVAILABLE_MESSAGE });
    expect(JSON.stringify(status)).not.toContain("GEMINI");
  });
});
