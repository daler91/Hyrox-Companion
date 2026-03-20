/**
 * Safely encodes HTML special characters to their corresponding HTML entities.
 * This prevents XSS attacks when rendering un-trusted data.
 */
const htmlEntityMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

export function sanitizeHtml(str: string): string {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, (match) => htmlEntityMap[match] || match);
}
