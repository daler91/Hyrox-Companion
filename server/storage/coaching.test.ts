import { describe, expect, it, vi } from "vitest";

// `query` is referenced inside the hoisted vi.mock factory below, so it must be
// created via vi.hoisted to exist before the module graph is evaluated.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));

// Mock the side-effectful imports of coaching.ts so this stays a pure unit test
// (no real pg Pool, no genai SDK, no env-dependent vector connection).
vi.mock("../db", () => ({ db: {} }));
vi.mock("../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072 }));
vi.mock("../vectorDb", () => ({ vectorPool: { query } }));

import { CoachingStorage } from "./coaching";

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
