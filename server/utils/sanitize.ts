/**
 * Safely encodes HTML special characters to their corresponding HTML entities.
 * This prevents XSS attacks when rendering un-trusted data.
 */
export function sanitizeHtml(str: string): string {
  if (typeof str !== "string") return str;
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Sanitizes user input specifically for AI prompt injection prevention.
 * Replaces XML-like tags to ensure users cannot break out of <user_input> delimiters
 * or inject fake system tags.
 */
export function sanitizeUserInput(input: string): string {
  if (typeof input !== "string") return input;
  // Use existing sanitizeHtml logic which handles < and >
  return sanitizeHtml(input);
}


/**
 * Validates AI output to detect prompt injection leakage or unexpected system-level content.
 * Throws an error or returns a safe fallback if restricted content is detected.
 */
export function validateAiOutput(output: string): string {
  if (typeof output !== "string") return output;

  const lowerOutput = output.toLowerCase();

  // Restricted keywords/phrases that indicate prompt injection leakage
  // We don't want the AI acknowledging "system prompt", "instructions", or using fake XML tags
  const restrictedPatterns = [
    "<system>",
    "</system>",
    "system prompt",
    "ignore previous instructions"
  ];

  for (const pattern of restrictedPatterns) {
    if (lowerOutput.includes(pattern)) {
      throw new Error("AI output validation failed: detected restricted system-level content");
    }
  }

  return output;
}
