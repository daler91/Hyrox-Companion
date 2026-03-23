import { logger } from "../logger";
import { generateEmbedding, generateEmbeddings, EMBEDDING_DIMENSIONS } from "../gemini/client";
import { storage } from "../storage";
import type { CoachingMaterial } from "@shared/schema";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = env.RAG_CHUNK_SIZE; // characters per chunk
const CHUNK_OVERLAP = env.RAG_CHUNK_OVERLAP; // overlap between chunks

/**
 * Find the best end position for a chunk, preferring paragraph or sentence boundaries.
 */
function findChunkEnd(text: string, start: number): number {
  const rawEnd = start + CHUNK_SIZE;
  if (rawEnd >= text.length) return text.length;

  const minEnd = start + CHUNK_SIZE / 2;

  // Try to break at paragraph boundary
  const paragraphBreak = text.lastIndexOf("\n\n", rawEnd);
  if (paragraphBreak > minEnd) return paragraphBreak;

  // Try sentence boundary
  const sentenceBreak = text.lastIndexOf(". ", rawEnd);
  if (sentenceBreak > minEnd) return sentenceBreak + 1;

  return rawEnd;
}

/**
 * Split text into overlapping chunks at paragraph/sentence boundaries.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = findChunkEnd(text, start);
    const chunk = text.slice(start, end).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    const nextStart = end - CHUNK_OVERLAP;
    // Ensure forward progress
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding pipeline
// ---------------------------------------------------------------------------

/**
 * Chunk and embed a coaching material, storing results in document_chunks.
 * Replaces any existing chunks for this material.
 */
export async function embedCoachingMaterial(material: CoachingMaterial): Promise<void> {
  try {
    const chunks = chunkText(material.content);
    if (chunks.length === 0) return;

    logger.info(
      { materialId: material.id, chunkCount: chunks.length },
      "[rag] Embedding coaching material",
    );

    // Prefix chunks with title for better semantic context
    const textsToEmbed = chunks.map(
      (chunk, i) =>
        i === 0
          ? `${material.title}: ${chunk}`
          : chunk,
    );

    const embeddings = await generateEmbeddings(textsToEmbed);

    // Replace old chunks with new ones transactionally, so a failure
    // doesn't leave the material with zero chunks or in an inconsistent state.
    await storage.replaceChunks(
      material.id,
      chunks.map((content, i) => ({
        materialId: material.id,
        userId: material.userId,
        content,
        chunkIndex: i,
        embedding: embeddings[i],
      })),
    );

    logger.info(
      { materialId: material.id, chunkCount: chunks.length },
      "[rag] Finished embedding coaching material",
    );
  } catch (error) {
    logger.error(
      { err: error, materialId: material.id },
      "[rag] Failed to embed coaching material",
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

const TOP_K = 6; // Number of chunks to retrieve

/**
 * Retrieve the most relevant coaching material chunks for a given query.
 * Returns chunk content strings ordered by relevance.
 */
export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  topK: number = TOP_K,
): Promise<string[]> {
  const queryEmbedding = await generateEmbedding(query);
  logger.info({ userId, queryDim: queryEmbedding.length, topK }, "[rag] Searching chunks by embedding");
  const chunks = await storage.searchChunksByEmbedding(userId, queryEmbedding, topK);
  logger.info({ userId, found: chunks.length }, "[rag] Search returned chunks");
  return chunks.map((c) => c.content);
}

/**
 * Build a coaching materials section from retrieved chunks instead of
 * the old truncation approach.
 */
export function buildRetrievedMaterialsSection(chunks: string[]): string {
  if (chunks.length === 0) return "";

  let section = `\n--- COACHING REFERENCE MATERIALS ---\n`;
  section += `Use these relevant excerpts from the athlete's coaching materials to guide your coaching decisions.\n\n`;

  for (let i = 0; i < chunks.length; i++) {
    section += `[Excerpt ${i + 1}]\n${chunks[i]}\n\n`;
  }

  section += `--- END COACHING MATERIALS ---\n`;
  return section;
}

export async function getRagStatus(userId: string) {
  const materials = await storage.listCoachingMaterials(userId);
  const chunkCounts = await storage.getChunkCountsByMaterial(userId);
  const chunkMap = new Map(chunkCounts.map((c) => [c.materialId, c]));

  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);
  const storedDimension = await storage.getStoredEmbeddingDimension(userId);

  const materialStatus = materials.map((m) => {
    const chunks = chunkMap.get(m.id);
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      contentLength: m.content.length,
      chunkCount: chunks?.chunkCount ?? 0,
      hasEmbeddings: chunks?.hasEmbeddings ?? false,
    };
  });

  const totalChunks = chunkCounts.reduce((sum, c) => sum + c.chunkCount, 0);
  const allEmbedded = materials.length > 0 && materials.every((m) => chunkMap.get(m.id)?.hasEmbeddings);

  let embeddingApiStatus: { ok: boolean; dimension?: number; error?: string } = { ok: false };
  if (hasApiKey) {
    try {
      const probe = await generateEmbedding("test");
      embeddingApiStatus = { ok: true, dimension: probe.length };
    } catch (err) {
      embeddingApiStatus = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    hasApiKey,
    totalMaterials: materials.length,
    totalChunks,
    allEmbedded,
    materials: materialStatus,
    storedDimension,
    expectedDimension: EMBEDDING_DIMENSIONS,
    dimensionMismatch: storedDimension !== null && storedDimension !== EMBEDDING_DIMENSIONS,
    embeddingApi: embeddingApiStatus,
  };
}

export async function reembedAllMaterials(userId: string) {
  const materials = await storage.listCoachingMaterials(userId);
  const errors: string[] = [];
  let count = 0;

  const results = await Promise.allSettled(
    materials.map(async (material) => {
      try {
        await embedCoachingMaterial(material);
        return material.id;
      } catch (err) {
        // Return structured error instead of throwing non-Error object
        return Promise.reject(new Error(JSON.stringify({
          id: material.id,
          message: err instanceof Error ? err.message : String(err)
        })));
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      count++;
    } else {
      const reason = result.reason as Error;
      try {
        const parsed = JSON.parse(reason.message);
        errors.push(`${parsed.id}: ${parsed.message}`);
      } catch {
        errors.push(`Unknown: ${reason.message}`);
      }
    }
  }

  return { success: true, materialsProcessed: count, errors };
}
