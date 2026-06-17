/**
 * Shared relevance scoring/gating for food search (FR-1.1). One place to decide
 * whether a result actually matches the typed query and how well, so every
 * provider (Edamam, USDA, Open Food Facts) and the orchestrator agree.
 *
 * The providers' own full-text search is noisy — USDA/OFF match on ingredients and
 * categories, so a bare query pulls in loosely-related products. Gating on the
 * food's NAME (+ brand) keeps results on-topic, and the score lets the orchestrator
 * rank the best matches first regardless of which provider returned them.
 *
 * Operates on the minimal `{ name, brand }` shape shared by `MappedFood` (pre-cache)
 * and the DB `Food` row (post-cache), so it works at every stage of the pipeline.
 */

interface NamedFood {
  name: string;
  brand: string | null;
}

/** Lowercase alphanumeric word tokens, e.g. "Greek Yoghurt 0%!" → ["greek","yoghurt","0"]. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Conservative English plural normalizer: "berries"→"berry", "tomatoes"→"tomato",
 * "peaches"→"peach", "oats"→"oat", while "glass" stays "glass". Deliberately NOT a
 * full Porter/Snowball stemmer — aggressive stemming invents matches. The `-oes`
 * rule matters because without it "tomatoes" stems to "tomatoe" (longer than the
 * singular), so a plural query would miss a singular "Tomato" food name.
 */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("oes")) return token.slice(0, -2); // tomatoes→tomato, mangoes→mango
  // "-ses": in food terms the singular almost always ends in "-se" (cheese→cheeses,
  // house→houses), so strip only the trailing "s". Must precede the sibilant rule,
  // which would otherwise strip "es" and corrupt "cheeses"→"chees".
  if (token.endsWith("ses")) return token.slice(0, -1);
  if (/(sh|ch|x|z)es$/.test(token)) return token.slice(0, -2); // dishes→dish, boxes→box
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** A query token matches a word if the query is a literal prefix of the word
 *  ("choc"→"Chocolate") OR the two are the same word up to a plural (stem EQUALITY,
 *  e.g. "berries"↔"Berry", "tomatoes"↔"Tomato"). Equality — not stem prefix — is
 *  deliberate: a shortened plural stem like "pea" must NOT prefix-match an unrelated
 *  word like "Peanut", which the gate would otherwise surface as a false match. */
function wordMatches(queryToken: string, word: string): boolean {
  return word.startsWith(queryToken) || stem(word) === stem(queryToken);
}

/**
 * Match quality of a food against the query, high→low:
 *   4 — exact: the food's name tokens equal the query tokens
 *   3 — the name begins with the full query (token-prefix)
 *   2 — every query token matches a word in the NAME
 *   1 — every query token matches a word in NAME + BRAND  (the gate floor)
 *   0 — otherwise (fails the relevance gate)
 */
export function relevanceScore(query: string, food: NamedFood): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const nameTokens = tokenize(food.name);
  const queryJoined = queryTokens.join(" ");
  const nameJoined = nameTokens.join(" ");

  if (nameJoined === queryJoined) return 4;
  if (nameJoined.startsWith(`${queryJoined} `)) return 3;
  if (queryTokens.every((token) => nameTokens.some((word) => wordMatches(token, word)))) return 2;
  const haystack = [...nameTokens, ...tokenize(food.brand ?? "")];
  if (queryTokens.every((token) => haystack.some((word) => wordMatches(token, word)))) return 1;
  return 0;
}

/** Relevance gate: true when every query token is found in the food's name or brand.
 *  Derived from the score so the gate and the ranking can never drift apart. */
export function isRelevantMatch(query: string, food: NamedFood): boolean {
  return relevanceScore(query, food) >= 1;
}

/**
 * Stable-sort items by descending relevance to the query. Ties keep the input order
 * (the orchestrator feeds results in provider-priority order), so ranking only
 * reorders when one result is a genuinely better textual match than another.
 */
export function rankByRelevance<T extends NamedFood>(query: string, items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, score: relevanceScore(query, item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
