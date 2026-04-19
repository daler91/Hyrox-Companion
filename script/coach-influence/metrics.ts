import type { WorkoutSuggestion } from "@shared/schema";

/**
 * Metric primitives for comparing two sets of AI-coach suggestions —
 * a "baseline" run bundle and a "variant" run bundle. Each metric maps
 * paired bundles into a 0–1 divergence score; higher means the variant
 * moved the model more.
 *
 * Run sizes are small (~3 per condition in the harness), so we favor
 * clarity over streaming/O(1) memory.
 */

export type SuggestionBundle = WorkoutSuggestion[];

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function targetKey(s: WorkoutSuggestion): string {
  return `${s.workoutId}::${s.targetField}`;
}

export function targetOverlap(
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): number {
  const aSet = new Set<string>();
  for (const run of baseline) for (const s of run) aSet.add(targetKey(s));
  const bSet = new Set<string>();
  for (const run of variant) for (const s of run) bSet.add(targetKey(s));
  return 1 - jaccard(aSet, bSet);
}

export function suggestionCountDelta(
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): number {
  const mean = (bs: SuggestionBundle[]) =>
    bs.length === 0 ? 0 : bs.reduce((n, r) => n + r.length, 0) / bs.length;
  return Math.abs(mean(variant) - mean(baseline));
}

function actionRatio(bs: SuggestionBundle[]): number {
  const flat = bs.flat();
  if (flat.length === 0) return 0;
  return flat.filter(s => s.action === "replace").length / flat.length;
}

export function actionShift(
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): number {
  return Math.abs(actionRatio(variant) - actionRatio(baseline));
}

function priorityVec(bs: SuggestionBundle[]): [number, number, number] {
  const flat = bs.flat();
  if (flat.length === 0) return [0, 0, 0];
  const n = flat.length;
  return [
    flat.filter(s => s.priority === "high").length / n,
    flat.filter(s => s.priority === "medium").length / n,
    flat.filter(s => s.priority === "low").length / n,
  ];
}

export function priorityShift(
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): number {
  const a = priorityVec(baseline);
  const b = priorityVec(variant);
  return (
    (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) /
    2
  );
}

const STOPWORDS = new Set([
  "a", "an", "and", "or", "but", "the", "of", "to", "in", "for", "on",
  "with", "at", "by", "from", "is", "are", "was", "were", "be", "been",
  "it", "this", "that", "these", "those", "as", "into", "over", "than",
  "then", "so", "your", "you", "i", "we", "they", "will", "can", "may",
  "should", "would", "could", "not", "no", "yes", "do", "does", "did",
  "has", "have", "had",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function tfVector(docs: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    for (const t of tokenize(d)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return counts;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  let an = 0;
  for (const v of a.values()) an += v * v;
  let bn = 0;
  for (const v of b.values()) bn += v * v;
  const denom = Math.sqrt(an) * Math.sqrt(bn);
  return denom === 0 ? 0 : dot / denom;
}

function rationaleText(bs: SuggestionBundle[]): string[] {
  return bs.flat().map(s => `${s.rationale} ${s.recommendation}`);
}

export function rationaleDrift(
  baseline: SuggestionBundle[],
  variant: SuggestionBundle[],
): number {
  const a = tfVector(rationaleText(baseline));
  const b = tfVector(rationaleText(variant));
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 1;
  return 1 - cosine(a, b);
}

export function keywordPresence(
  bundles: SuggestionBundle[],
  keywords: string[],
): { matched: string[]; ratio: number } {
  if (keywords.length === 0) return { matched: [], ratio: 0 };
  const text = rationaleText(bundles).join(" ").toLowerCase();
  const matched = keywords.filter(k => text.includes(k.toLowerCase()));
  return { matched, ratio: matched.length / keywords.length };
}

export interface ScenarioScore {
  input: string;
  suggestionCountDelta: number;
  targetOverlap: number;
  actionShift: number;
  priorityShift: number;
  rationaleDrift: number;
  keywordRatio: number;
  keywordMatched: string[];
  influence: number;
}

const WEIGHTS = {
  targetOverlap: 0.25,
  rationaleDrift: 0.25,
  keywordRatio: 0.25,
  priorityShift: 0.15,
  actionShift: 0.1,
};

/**
 * Combine per-scenario metrics into a single influence score in [0,1].
 * `suggestionCountDelta` is reported but intentionally excluded from
 * the weighted sum — large count differences often reflect Gemini
 * latency variance rather than semantic sensitivity.
 */
export function influenceScore(m: Omit<ScenarioScore, "input" | "influence">): number {
  const raw =
    m.targetOverlap * WEIGHTS.targetOverlap +
    m.rationaleDrift * WEIGHTS.rationaleDrift +
    m.keywordRatio * WEIGHTS.keywordRatio +
    m.priorityShift * WEIGHTS.priorityShift +
    m.actionShift * WEIGHTS.actionShift;
  return Math.min(1, Math.max(0, raw));
}

export function verdict(influence: number, noiseFloor: number): string {
  if (influence <= noiseFloor + 0.05) return "IGNORED";
  if (influence < 0.25) return "WEAK";
  if (influence < 0.55) return "MODERATE";
  return "STRONG";
}
