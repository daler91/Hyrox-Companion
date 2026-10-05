import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "../../gemini/client";
import { ensureVectorSchema } from "../../maintenance";
import { vectorPool } from "../../vectorDb";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * RAG retrieval's reads against the REAL schema: the per-athlete chunk search
 * (AI33) and the retrieval version the RAG cache keys on (AI34). The service
 * tests mock both. CODEBASE_ANALYSIS_2026-10-03
 */
describe("coaching retrieval reads (real Postgres)", () => {
  const ALICE = "rag-alice";
  const BOB = "rag-bob";

  /** A unit vector `degrees` away from the query's direction: cosine distance 1 - cos(degrees). */
  function direction(degrees: number): number[] {
    const radians = (degrees * Math.PI) / 180;
    return Array.from({ length: EMBEDDING_DIMENSIONS }, (_unused, index) => {
      if (index === 0) return Math.cos(radians);
      return index === 1 ? Math.sin(radians) : 0;
    });
  }

  async function seedMaterial(userId: string, title: string): Promise<string> {
    const material = await storage.coaching.createCoachingMaterial({ userId, title, content: `${title} text`, type: "document" });
    return material.id;
  }

  async function seedChunks(userId: string, materialId: string, angles: (number | null)[]): Promise<void> {
    await storage.coaching.replaceChunks(
      materialId,
      angles.map((angle, index) => ({
        materialId,
        userId,
        content: `${userId} chunk ${index}`,
        chunkIndex: index,
        embedding: angle === null ? null : direction(angle),
      })),
    );
  }

  async function clearChunks(): Promise<void> {
    await vectorPool.query("DELETE FROM document_chunks WHERE user_id = ANY($1)", [[ALICE, BOB]]);
  }

  // document_chunks lives in the vector schema, which the server creates at
  // boot; this also builds the shared HNSW index where pgvector can.
  beforeAll(async () => {
    await ensureVectorSchema();
  });

  beforeEach(async () => {
    await clearChunks();
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await clearChunks();
    await resetIntegrationDb();
  });

  describe("searchChunksByEmbedding (AI33)", () => {
    it("returns the athlete's own topK nearest, though another athlete's chunks are all nearer", async () => {
      // Bob's 60 chunks sit almost on the query; Alice's 8 are 50-85 degrees off.
      await seedChunks(BOB, await seedMaterial(BOB, "Bob's notes"), Array.from({ length: 60 }, (_unused, index) => index / 12));
      await seedChunks(ALICE, await seedMaterial(ALICE, "Alice's notes"), [85, 50, 80, 55, 75, 60, 70, 65, null]);

      const found = await storage.coaching.searchChunksByEmbedding(ALICE, direction(0), 6);

      expect(found).toHaveLength(6);
      expect(found.every((chunk) => chunk.userId === ALICE)).toBe(true);
      expect(found.map((chunk) => chunk.content)).toEqual([1, 3, 5, 7, 6, 4].map((index) => `${ALICE} chunk ${index}`));
      expect(found.at(0)?.distance).toBeCloseTo(1 - Math.cos((50 * Math.PI) / 180), 5);
    });

    it("returns every embedded chunk an athlete with fewer than topK has", async () => {
      await seedChunks(BOB, await seedMaterial(BOB, "Bob's notes"), Array.from({ length: 20 }, () => 1));
      await seedChunks(ALICE, await seedMaterial(ALICE, "Alice's notes"), [40, null, 20]);

      const found = await storage.coaching.searchChunksByEmbedding(ALICE, direction(0), 6);

      expect(found.map((chunk) => chunk.content)).toEqual([`${ALICE} chunk 2`, `${ALICE} chunk 0`]);
    });
  });

  describe("getRetrievalVersion (AI34)", () => {
    it("changes with every create, edit, re-embed and delete, and only for that athlete", async () => {
      const versions = [await storage.coaching.getRetrievalVersion(ALICE)];
      const record = async () => {
        const version = await storage.coaching.getRetrievalVersion(ALICE);
        versions.push(version);
        return version;
      };

      // The version reads no embeddings, so none are written here.
      const materialId = await seedMaterial(ALICE, "Sled technique");
      await record();
      await seedChunks(ALICE, materialId, [null, null]);
      await record();
      // A re-embed writes the same number of chunks again.
      await seedChunks(ALICE, materialId, [null, null]);
      await record();
      await storage.coaching.updateCoachingMaterial(materialId, { type: "principles" }, ALICE);
      const beforeBob = await record();
      await seedChunks(BOB, await seedMaterial(BOB, "Bob's notes"), [null]);
      expect(await storage.coaching.getRetrievalVersion(ALICE)).toBe(beforeBob);
      await storage.coaching.deleteChunksByMaterialId(materialId, ALICE);
      await record();
      await storage.coaching.deleteCoachingMaterial(materialId, ALICE);
      await record();

      // Each step's version is new; with everything gone it is the empty one again.
      const steps = versions.slice(0, -1);
      expect(new Set(steps).size).toBe(steps.length);
      expect(versions.at(-1)).toBe(versions.at(0));
    });
  });
});
