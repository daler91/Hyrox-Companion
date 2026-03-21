import { describe, it, expect, vi, beforeEach } from "vitest";
import { chunkText, embedCoachingMaterial, retrieveRelevantChunks, buildRetrievedMaterialsSection } from "./ragService";
import type { CoachingMaterial } from "@shared/schema";

// Mock dependencies
vi.mock("../gemini/client", () => ({
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    deleteChunksByMaterialId: vi.fn(),
    insertChunks: vi.fn(),
    searchChunksByEmbedding: vi.fn(),
  },
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { generateEmbedding, generateEmbeddings } from "../gemini/client";
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
    vi.clearAllMocks();
  });

  it("should delete existing chunks then insert new ones", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1, 0.2]]);
    vi.mocked(storage.insertChunks).mockResolvedValue([]);

    await embedCoachingMaterial(mockMaterial);

    expect(storage.deleteChunksByMaterialId).toHaveBeenCalledWith("mat_1");
    expect(storage.insertChunks).toHaveBeenCalledWith([
      {
        materialId: "mat_1",
        userId: "user_1",
        content: "Short content for testing.",
        chunkIndex: 0,
        embedding: JSON.stringify([0.1, 0.2]),
      },
    ]);
  });

  it("should prefix first chunk with material title", async () => {
    vi.mocked(generateEmbeddings).mockResolvedValue([[0.1]]);
    vi.mocked(storage.insertChunks).mockResolvedValue([]);

    await embedCoachingMaterial(mockMaterial);

    // generateEmbeddings should receive the title-prefixed text
    const call = vi.mocked(generateEmbeddings).mock.calls[0][0];
    expect(call[0]).toBe("Training Guide: Short content for testing.");
  });

  it("should skip everything when content is empty", async () => {
    const emptyMaterial = { ...mockMaterial, content: "" };

    await embedCoachingMaterial(emptyMaterial);

    expect(storage.deleteChunksByMaterialId).not.toHaveBeenCalled();
    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(storage.insertChunks).not.toHaveBeenCalled();
  });

  it("should handle multiple chunks with correct indices", async () => {
    const longContent = "a".repeat(1500);
    const longMaterial = { ...mockMaterial, content: longContent };

    // Mock embeddings for however many chunks are generated
    vi.mocked(generateEmbeddings).mockImplementation(async (texts) =>
      texts.map(() => [0.5]),
    );
    vi.mocked(storage.insertChunks).mockResolvedValue([]);

    await embedCoachingMaterial(longMaterial);

    const insertedChunks = vi.mocked(storage.insertChunks).mock.calls[0][0];
    expect(insertedChunks.length).toBeGreaterThan(1);
    // Verify indices are sequential
    insertedChunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.materialId).toBe("mat_1");
      expect(chunk.userId).toBe("user_1");
    });
  });

  it("should throw when embedding fails (callers handle errors)", async () => {
    vi.mocked(generateEmbeddings).mockRejectedValue(new Error("API error"));

    await expect(embedCoachingMaterial(mockMaterial)).rejects.toThrow("API error");
  });
});

// ---------------------------------------------------------------------------
// retrieveRelevantChunks
// ---------------------------------------------------------------------------

describe("retrieveRelevantChunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should embed query and search for similar chunks", async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];
    vi.mocked(generateEmbedding).mockResolvedValue(queryEmbedding);
    vi.mocked(storage.searchChunksByEmbedding).mockResolvedValue([
      { id: "c1", materialId: "m1", userId: "u1", content: "chunk 1", chunkIndex: 0, embedding: null, createdAt: new Date() },
      { id: "c2", materialId: "m1", userId: "u1", content: "chunk 2", chunkIndex: 1, embedding: null, createdAt: new Date() },
    ]);

    const result = await retrieveRelevantChunks("u1", "how to train");

    expect(generateEmbedding).toHaveBeenCalledWith("how to train");
    expect(storage.searchChunksByEmbedding).toHaveBeenCalledWith("u1", queryEmbedding, 6);
    expect(result).toEqual(["chunk 1", "chunk 2"]);
  });

  it("should respect custom topK parameter", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue([0.1]);
    vi.mocked(storage.searchChunksByEmbedding).mockResolvedValue([]);

    await retrieveRelevantChunks("u1", "query", 3);

    expect(storage.searchChunksByEmbedding).toHaveBeenCalledWith("u1", [0.1], 3);
  });

  it("should return empty array on error", async () => {
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("API down"));

    const result = await retrieveRelevantChunks("u1", "query");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRetrievedMaterialsSection
// ---------------------------------------------------------------------------

describe("buildRetrievedMaterialsSection", () => {
  it("should return empty string for no chunks", () => {
    expect(buildRetrievedMaterialsSection([])).toBe("");
  });

  it("should format chunks with excerpt labels", () => {
    const result = buildRetrievedMaterialsSection(["First chunk", "Second chunk"]);

    expect(result).toContain("COACHING REFERENCE MATERIALS");
    expect(result).toContain("[Excerpt 1]");
    expect(result).toContain("First chunk");
    expect(result).toContain("[Excerpt 2]");
    expect(result).toContain("Second chunk");
    expect(result).toContain("END COACHING MATERIALS");
  });

  it("should include all chunks in order", () => {
    const chunks = ["A", "B", "C"];
    const result = buildRetrievedMaterialsSection(chunks);

    const indexA = result.indexOf("[Excerpt 1]");
    const indexB = result.indexOf("[Excerpt 2]");
    const indexC = result.indexOf("[Excerpt 3]");
    expect(indexA).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexC);
  });
});
