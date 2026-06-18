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

import { canonicalize, synonymsOf } from "./synonyms";

// Minimum pg_trgm similarity (matches the SQL threshold in storage/nutrition.ts) for
// a fuzzy local hit to earn a fractional rank when no textual tier matches.
const FUZZY_MIN_SIMILARITY = 0.3;

interface NamedFood {
  name: string;
  brand: string | null;
  // Optional pg_trgm similarity attached by the local fuzzy search
  // (`server/storage/nutrition.ts`); used only to rank typo matches (see below).
  _localSim?: number;
}

/** Lowercase alphanumeric word tokens, with diacritics stripped so "Café"→["cafe"]
 *  and "jalapeño"→["jalapeno"]. ASCII is unchanged: "Greek Yoghurt 0%!"→["greek","yoghurt","0"]. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // strip combining marks left by NFD (accents)
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
 *  ("choc"→"Chocolate"), the two are the same word up to a plural ("berries"↔"Berry"),
 *  or they're registered synonyms ("courgette"↔"zucchini"). Canonicalizing the stems
 *  folds plural-equality and synonym-equality into one check; stem EQUALITY (not
 *  prefix) keeps a shortened plural like "pea" from matching "Peanut". */
function wordMatches(queryToken: string, word: string): boolean {
  return word.startsWith(queryToken) || canonicalize(stem(queryToken)) === canonicalize(stem(word));
}

/**
 * Match quality of a food against the query, high→low:
 *   4 — exact: the food's name tokens equal the query tokens
 *   3 — the name begins with the full query (token-prefix)
 *   2 — every query token matches a word in the NAME
 *   1 — every query token matches a word in NAME + BRAND  (the gate floor)
 *   0.5–0.9 — no token match, but a high trigram `_localSim` (a local fuzzy/typo hit)
 *   0 — otherwise (fails the relevance gate)
 * Only the integer tiers (≥1) pass `isRelevantMatch`; the fractional fuzzy band ranks
 * "did you mean" hits below every real match but above unrelated noise.
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
  // Fuzzy fallback: a typo'd local hit ("yoghrt"→"Yogurt") has no token match but a
  // high trigram similarity. Score it in (0,1) — above unrelated noise, below any
  // genuine token match — so it ranks as a "did you mean" without ever beating one.
  if (food._localSim !== undefined && food._localSim >= FUZZY_MIN_SIMILARITY) {
    return 0.5 + 0.4 * Math.min(food._localSim, 1);
  }
  return 0;
}

/** Relevance gate: true when every query token is found in the food's name or brand.
 *  Derived from the score so the gate and the ranking can never drift apart. */
export function isRelevantMatch(query: string, food: NamedFood): boolean {
  return relevanceScore(query, food) >= 1;
}

/**
 * Expand a search query into the verbatim query plus synonym variants, so the SQL
 * layer can RETRIEVE a local food stored under a synonym ("courgette" also searches
 * "zucchini"). Substitutes each token's synonyms, bounded to avoid blow-up. Returns
 * unique normalized strings; the first is always the verbatim (normalized) query.
 */
export function expandQuery(query: string): string[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const MAX_VARIANTS = 8;
  let variants: string[] = [""];
  for (const token of tokens) {
    const synonyms = synonymsOf(stem(token));
    const options = synonyms.length > 0 ? synonyms : [token];
    const next: string[] = [];
    for (const prefix of variants) {
      for (const option of options) next.push(prefix ? `${prefix} ${option}` : option);
    }
    variants = next.slice(0, MAX_VARIANTS);
  }
  return [...new Set([tokens.join(" "), ...variants])];
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
