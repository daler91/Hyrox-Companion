import { beforeEach, describe, expect, it, vi } from "vitest";

// `query` and `select` are referenced inside the hoisted vi.mock factories
// below, so they must be created via vi.hoisted to exist before the module
// graph is evaluated.
const { query, select } = vi.hoisted(() => ({ query: vi.fn(), select: vi.fn() }));

// Mock the side-effectful imports of coaching.ts so this stays a pure unit test
// (no real pg Pool, no genai SDK, no env-dependent vector connection).
vi.mock("../db", () => ({ db: { select } }));
vi.mock("../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072 }));
vi.mock("../vectorDb", () => ({ vectorPool: { query } }));

import { CoachingStorage } from "./coaching";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoachingStorage.deleteChunksByUserId", () => {
  it("purges all of a user's RAG chunks from the vector DB (account erasure, GDPR Art. 17)", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const storage = new CoachingStorage();

    await storage.deleteChunksByUserId("user-42");

    // Must scope on user_id (not material_id) and run against vectorPool — the
    // main-DB FK cascade cannot reach the separate vector database.
    expect(query).toHaveBeenCalledWith("DELETE FROM document_chunks WHERE user_id = $1", [
      "user-42",
    ]);
  });
});

describe("CoachingStorage.listPrincipleMaterialIds", () => {
  it("returns ids of the user's principle materials, oldest first", async () => {
    const orderByMock = vi.fn().mockResolvedValue([{ id: "m-1" }, { id: "m-2" }]);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    select.mockReturnValue({ from: fromMock });
    const storage = new CoachingStorage();

    const ids = await storage.listPrincipleMaterialIds("user-1");

    expect(ids).toEqual(["m-1", "m-2"]);
  });

  it("returns an empty array when the user has no principle materials", async () => {
    const orderByMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    select.mockReturnValue({ from: fromMock });
    const storage = new CoachingStorage();

    const ids = await storage.listPrincipleMaterialIds("user-1");

    expect(ids).toEqual([]);
  });
});

describe("CoachingStorage.listChunksForMaterials", () => {
  it("returns an empty array without querying when no material ids are given", async () => {
    const storage = new CoachingStorage();

    const chunks = await storage.listChunksForMaterials("user-1", [], 10);

    expect(chunks).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns an empty array without querying when the limit is zero or negative", async () => {
    const storage = new CoachingStorage();

    const chunks = await storage.listChunksForMaterials("user-1", ["m-1"], 0);

    expect(chunks).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries chunks for the given materials, scoped to the user and capped at the limit", async () => {
    const rows = [
      { id: "c-1", materialId: "m-1", userId: "user-1", content: "text", chunkIndex: 0, createdAt: new Date() },
    ];
    query.mockResolvedValue({ rows });
    const storage = new CoachingStorage();

    const chunks = await storage.listChunksForMaterials("user-1", ["m-1", "m-2"], 5);

    expect(chunks).toEqual(rows);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM document_chunks"), [
      "user-1",
      ["m-1", "m-2"],
      5,
    ]);
  });
});
