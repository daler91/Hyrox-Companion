/**
 * The athlete card (coach-memory spec, Path C): constants and pure helpers
 * shared by the client and the server.
 *
 * A leaf module on purpose, like `shared/chat.ts`: the Settings card counts
 * against these limits, and a value-import from the `@shared/schema` barrel
 * would drag the drizzle graph into the browser bundle.
 */

import { addDaysToISODate } from "./dateUtils";

/** One short statement per fact, so each can be deleted and reviewed on its own (spec §3). */
export const ATHLETE_FACT_MAX_LENGTH = 140;

/**
 * Active facts an athlete may hold. Enforced when a fact is written, never
 * when the card is rendered: a render-side cap would silently drop something
 * the athlete typed.
 */
export const MAX_ACTIVE_ATHLETE_FACTS = 20;

/** What the athlete is told when a new or restored fact would go over the cap. */
export const ATHLETE_FACT_LIMIT_MESSAGE = `Your card holds up to ${MAX_ACTIVE_ATHLETE_FACTS} facts. Retire one that no longer applies first.`;

/** How long a fact stands before the athlete is asked whether it is still true (spec §2). */
export const ATHLETE_FACT_REVIEW_DAYS = 90;

/** The fact as one line: trimmed, with runs of whitespace (newlines included) collapsed to one space. */
export function normalizeFactText(text: string): string {
  return text.trim().replaceAll(/\s+/g, " ");
}

/**
 * The key two facts are "the same" by: case, spacing and a closing full stop
 * don't make a different fact. "No sled at my gym." from the plan wizard and
 * "no sled at my gym" from chat re-confirm one row instead of adding another.
 */
export function athleteFactKey(text: string): string {
  const normalized = normalizeFactText(text).toLowerCase();
  let end = normalized.length;
  while (end > 0 && ".! ".includes(normalized.charAt(end - 1))) end -= 1;
  return normalized.slice(0, end);
}

/** The review date for a fact stated, or confirmed, on `today` (YYYY-MM-DD). */
export function athleteFactReviewOn(today: string): string {
  return addDaysToISODate(today, ATHLETE_FACT_REVIEW_DAYS);
}

/** A fact whose review date has come: still true, but the athlete hasn't said so lately. */
export function isAthleteFactDue(reviewOn: string, today: string): boolean {
  return reviewOn <= today;
}

/**
 * Everything the athlete has said always holds, as one text: the older
 * free-text note, then each active fact on the card. The deterministic checks
 * read this (station-gap suppression, the exercise selection, the
 * heart-rate-medication disclaimer); the prompts render the two separately.
 * Null when the athlete has said nothing.
 */
export function standingConstraintsText(
  note: string | null | undefined,
  facts: readonly { readonly fact: string }[] | undefined,
): string | null {
  const parts = [note?.trim() ?? "", ...(facts ?? []).map(({ fact }) => fact)].filter((part) => part !== "");
  return parts.length > 0 ? parts.join("\n") : null;
}

/** A piece longer than a fact, cut at the last word that fits, marked as cut. */
function fitToFact(piece: string): string {
  if (piece.length <= ATHLETE_FACT_MAX_LENGTH) return piece;
  const room = piece.slice(0, ATHLETE_FACT_MAX_LENGTH - 1);
  const lastSpace = room.lastIndexOf(" ");
  return `${(lastSpace > ATHLETE_FACT_MAX_LENGTH / 2 ? room.slice(0, lastSpace) : room).trimEnd()}…`;
}

/** A leading list marker the athlete typed: "-", "*", "•", "1." or "1)". */
const LIST_MARKER = /^(?:[-*•–—]+|\d+[.)])\s*/;

/**
 * Free text the athlete wrote elsewhere (the plan wizard's injuries box, the
 * older Settings note) as facts: one per line or sentence, without list
 * markers, each cut to fit, and each kept once by its key. A piece with no
 * letters in it isn't a fact.
 */
export function splitIntoFacts(text: string): string[] {
  const seen = new Set<string>();
  const facts: string[] = [];
  const pieces = text
    .replaceAll(/([.!?])\s+/g, "$1\n")
    .split(/[\n;]+/)
    .map((piece) => fitToFact(normalizeFactText(normalizeFactText(piece).replace(LIST_MARKER, ""))));
  for (const piece of pieces) {
    const key = athleteFactKey(piece);
    if (!/\p{L}/u.test(piece) || seen.has(key)) continue;
    seen.add(key);
    facts.push(piece);
  }
  return facts;
}
