import { logger } from "../logger";
import { generateEmbedding, generateEmbeddings } from "../gemini/client";
import { storage } from "../storage";
import type { CoachingMaterial } from "@shared/schema";

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 600; // characters per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks

/**
 * Split text into overlapping chunks at paragraph/sentence boundaries.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    if (end < text.length) {
      // Try to break at paragraph boundary
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE / 2) {
        end = paragraphBreak;
      } else {
        // Try sentence boundary
        const sentenceBreak = text.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE / 2) {
          end = sentenceBreak + 1; // include the period
        }
      }
    } else {
      end = text.length;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Prevent infinite loop if we can't advance
    if (end <= start + CHUNK_OVERLAP && end < text.length) {
      start = end;
    }
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
    // Delete existing chunks for this material
    await storage.deleteChunksByMaterialId(material.id);

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

    // Store chunks with embeddings
    await storage.insertChunks(
      chunks.map((content, i) => ({
        materialId: material.id,
        userId: material.userId,
        content,
        chunkIndex: i,
        embedding: JSON.stringify(embeddings[i]),
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
  try {
    const queryEmbedding = await generateEmbedding(query);
    const chunks = await storage.searchChunksByEmbedding(userId, queryEmbedding, topK);
    return chunks.map((c) => c.content);
  } catch (error) {
    logger.error({ err: error, userId }, "[rag] Failed to retrieve chunks, falling back to empty");
    return [];
  }
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
