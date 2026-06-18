/**
 * Curated food-name synonyms (regional + alternate names) so search matches across
 * spellings/dialects: "courgette"↔"zucchini", "cilantro"↔"coriander", etc.
 *
 * SINGLE-TOKEN aliases only. Multi-word/phrase synonyms ("soft drink"↔"soda",
 * "bell pepper"↔"capsicum") need query expansion and are a deliberate follow-up.
 *
 * Keys are STEMMED forms — callers pass `canonicalize(stem(token))` (see
 * `relevance.wordMatches`) — so a plural of an alias ("yoghurts") still resolves.
 * Two tokens are synonyms iff they canonicalize to the same group id.
 */

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["yogurt", "yoghurt"],
  ["zucchini", "courgette"],
  ["eggplant", "aubergine"],
  ["shrimp", "prawn"],
  ["cilantro", "coriander"],
  ["garbanzo", "chickpea"],
  ["arugula", "rocket"],
  ["rutabaga", "swede"],
  ["oatmeal", "porridge"],
  ["soy", "soya"],
  ["confectioner", "powdered"], // "confectioner('s) sugar" ↔ "powdered sugar"
  ["beetroot", "beet"],
  ["maize", "corn"],
];

// Stemmed token → canonical group id (the group's first member). Built once.
const CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) CANONICAL.set(term, group[0]);
}

/**
 * Canonical group id for a (stemmed) token, or the token itself when it has no known
 * synonym. So `canonicalize(a) === canonicalize(b)` is true when a and b are the same
 * token OR registered synonyms — letting the relevance matcher treat aliases as equal.
 */
export function canonicalize(token: string): string {
  return CANONICAL.get(token) ?? token;
}
