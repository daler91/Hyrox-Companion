import { logger } from "../logger";
import { generateEmbedding, generateEmbeddings } from "../gemini/client";
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

    // Only delete old chunks after new embeddings succeed, so a failure
    // doesn't leave the material with zero chunks.
    await storage.deleteChunksByMaterialId(material.id);

    // Store chunks with embeddings
    await storage.insertChunks(
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
