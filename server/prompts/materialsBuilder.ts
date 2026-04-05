import { sanitizeUserInput } from "../utils/sanitize";

export interface CoachingMaterialInput {
  title: string;
  content: string;
  type: string;
}

const MAX_COACHING_MATERIALS_CHARS = 8000;

/**
 * Legacy fallback: build coaching materials by simple truncation.
 * Used when RAG pipeline is not available (no embedded chunks yet).
 */
export function buildCoachingMaterialsSection(materials: CoachingMaterialInput[]): string {
  if (!materials || materials.length === 0) return "";

  let section = `\n--- COACHING REFERENCE MATERIALS ---\n`;
  section += `Use these materials to guide your coaching decisions, exercise selection, and programming.\n\n`;

  let totalChars = 0;
  for (const material of materials) {
    const remaining = MAX_COACHING_MATERIALS_CHARS - totalChars;
    if (remaining <= 0) break;

    const content = material.content.length > remaining
      ? material.content.slice(0, remaining) + "... [truncated]"
      : material.content;

    section += `### ${material.title} (${material.type})\n${content}\n\n`;
    totalChars += content.length;
  }

  section += `--- END COACHING MATERIALS ---\n`;
  return section;
}

/**
 * Build coaching materials section from RAG-retrieved chunks.
 */
export function buildRetrievedChunksSection(chunks: string[]): string {
  if (chunks.length === 0) return "";

  let section = `\n--- COACHING REFERENCE MATERIALS ---\n`;
  section += `Use these relevant excerpts from the athlete's coaching materials to guide your coaching decisions.\n\n`;

  for (let i = 0; i < chunks.length; i++) {
    // 🛡️ Sentinel: Sanitize retrieved chunks to mitigate prompt injection via user-uploaded materials
    section += `[Excerpt ${i + 1}]\n${sanitizeUserInput(chunks[i])}\n\n`;
  }

  section += `--- END COACHING MATERIALS ---\n`;
  return section;
}
