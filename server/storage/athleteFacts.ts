import { athleteFactKey, MAX_ACTIVE_ATHLETE_FACTS, normalizeFactText } from "@shared/athleteFacts";
import { type AthleteFact, type AthleteFactCategory, athleteFacts, type AthleteFactSource } from "@shared/schema";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import { db, type Tx } from "../db";

/** A fact as a caller states it; the key and the stored wording are derived here. */
export interface NewAthleteFact {
  readonly fact: string;
  readonly category: AthleteFactCategory;
  readonly source: AthleteFactSource;
}

/** What to change on one fact. `reviewOn` is set when the athlete confirms or restores it. */
export interface AthleteFactPatch {
  readonly fact?: string;
  readonly category?: AthleteFactCategory;
  readonly active?: boolean;
  readonly reviewOn?: string;
}

/**
 * A write's outcome. Refused when it would take the athlete past the active
 * cap, when another fact already says the same thing, or when there is no such
 * fact of theirs.
 */
export type AthleteFactWrite =
  | { readonly ok: true; readonly fact: AthleteFact; readonly created: boolean }
  | { readonly ok: false; readonly reason: "limit" | "duplicate" | "not_found" };

/**
 * Serialize one athlete's fact writes for the rest of the transaction, so two
 * writes at once can't both count 19 active facts and land a 21st.
 */
async function lockAthleteFacts(tx: Tx, userId: string): Promise<void> {
  const lockKey = `athlete_facts:${userId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

async function countActive(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(athleteFacts)
    .where(and(eq(athleteFacts.userId, userId), eq(athleteFacts.active, true)));
  return row?.n ?? 0;
}

/** A stated fact as it is stored: one line, keyed by athleteFactKey. */
function prepare(input: NewAthleteFact, userId: string, reviewOn: string) {
  const fact = normalizeFactText(input.fact);
  return { userId, fact, dedupeKey: athleteFactKey(fact), category: input.category, source: input.source, reviewOn };
}

/**
 * Stating a fact the card already holds re-confirms that row: it is active
 * again, takes the new wording and category, and its review date moves out.
 * Where it came from first is kept.
 */
const RECONFIRM = {
  fact: sql`excluded.fact`,
  category: sql`excluded.category`,
  active: true,
  reviewOn: sql`excluded.review_on`,
  updatedAt: sql`now()`,
};

/** All the athlete's facts, retired ones included, oldest first. */
async function listAthleteFacts(userId: string): Promise<AthleteFact[]> {
  return await db
    .select()
    .from(athleteFacts)
    .where(eq(athleteFacts.userId, userId))
    .orderBy(asc(athleteFacts.createdAt), asc(athleteFacts.id));
}

/** The facts the coach reads: the active ones, oldest first. */
async function listActiveAthleteFacts(userId: string): Promise<AthleteFact[]> {
  return await db
    .select()
    .from(athleteFacts)
    .where(and(eq(athleteFacts.userId, userId), eq(athleteFacts.active, true)))
    .orderBy(asc(athleteFacts.createdAt), asc(athleteFacts.id));
}

/** Add a fact, or re-confirm the one that already says it, within the active cap. */
async function addAthleteFact(userId: string, input: NewAthleteFact, reviewOn: string): Promise<AthleteFactWrite> {
  const row = prepare(input, userId, reviewOn);
  return await db.transaction(async (tx) => {
    await lockAthleteFacts(tx, userId);
    const [existing] = await tx
      .select({ active: athleteFacts.active })
      .from(athleteFacts)
      .where(and(eq(athleteFacts.userId, userId), eq(athleteFacts.dedupeKey, row.dedupeKey)));
    if (!existing?.active && (await countActive(tx, userId)) >= MAX_ACTIVE_ATHLETE_FACTS) {
      return { ok: false, reason: "limit" } as const;
    }
    const [fact] = await tx
      .insert(athleteFacts)
      .values(row)
      .onConflictDoUpdate({ target: [athleteFacts.userId, athleteFacts.dedupeKey], set: RECONFIRM })
      .returning();
    return { ok: true, fact, created: !existing } as const;
  });
}

/**
 * Add or re-confirm several facts the athlete wrote elsewhere (the plan
 * wizard's injuries box, the older Settings note), as many as fit under the
 * cap. Best effort by design: a fact that doesn't fit is skipped and counted,
 * never an error.
 */
async function seedAthleteFacts(
  userId: string,
  inputs: readonly NewAthleteFact[],
  reviewOn: string,
): Promise<{ added: number; skipped: number }> {
  const rows = [...new Map(inputs.map((input) => {
    const row = prepare(input, userId, reviewOn);
    return [row.dedupeKey, row] as const;
  })).values()];
  if (rows.length === 0) return { added: 0, skipped: 0 };
  return await db.transaction(async (tx) => {
    await lockAthleteFacts(tx, userId);
    const existing = await tx
      .select({ dedupeKey: athleteFacts.dedupeKey, active: athleteFacts.active })
      .from(athleteFacts)
      .where(and(eq(athleteFacts.userId, userId), inArray(athleteFacts.dedupeKey, rows.map((row) => row.dedupeKey))));
    const alreadyActive = new Set(existing.filter((row) => row.active).map((row) => row.dedupeKey));
    let room = MAX_ACTIVE_ATHLETE_FACTS - (await countActive(tx, userId));
    const toWrite = rows.filter((row) => {
      if (alreadyActive.has(row.dedupeKey)) return true;
      if (room <= 0) return false;
      room -= 1;
      return true;
    });
    if (toWrite.length > 0) {
      await tx
        .insert(athleteFacts)
        .values(toWrite)
        .onConflictDoUpdate({ target: [athleteFacts.userId, athleteFacts.dedupeKey], set: RECONFIRM });
    }
    return { added: toWrite.length, skipped: rows.length - toWrite.length };
  });
}

/** Change one fact's wording or category, retire or restore it, or move its review date out. */
async function updateAthleteFact(userId: string, id: string, patch: AthleteFactPatch): Promise<AthleteFactWrite> {
  const fact = patch.fact === undefined ? undefined : normalizeFactText(patch.fact);
  return await db.transaction(async (tx) => {
    await lockAthleteFacts(tx, userId);
    const [existing] = await tx
      .select({ active: athleteFacts.active })
      .from(athleteFacts)
      .where(and(eq(athleteFacts.id, id), eq(athleteFacts.userId, userId)));
    if (!existing) return { ok: false, reason: "not_found" } as const;
    if (patch.active === true && !existing.active && (await countActive(tx, userId)) >= MAX_ACTIVE_ATHLETE_FACTS) {
      return { ok: false, reason: "limit" } as const;
    }
    const dedupeKey = fact === undefined ? undefined : athleteFactKey(fact);
    if (dedupeKey !== undefined) {
      const [clash] = await tx
        .select({ id: athleteFacts.id })
        .from(athleteFacts)
        .where(and(eq(athleteFacts.userId, userId), eq(athleteFacts.dedupeKey, dedupeKey), ne(athleteFacts.id, id)));
      if (clash) return { ok: false, reason: "duplicate" } as const;
    }
    const [row] = await tx
      .update(athleteFacts)
      .set({
        ...(fact !== undefined && dedupeKey !== undefined ? { fact, dedupeKey } : {}),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.active === undefined ? {} : { active: patch.active }),
        ...(patch.reviewOn === undefined ? {} : { reviewOn: patch.reviewOn }),
        updatedAt: new Date(),
      })
      .where(and(eq(athleteFacts.id, id), eq(athleteFacts.userId, userId)))
      .returning();
    return { ok: true, fact: row, created: false } as const;
  });
}

/** Delete one of the athlete's facts. Returns whether there was one. */
async function deleteAthleteFact(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(athleteFacts)
    .where(and(eq(athleteFacts.id, id), eq(athleteFacts.userId, userId)))
    .returning({ id: athleteFacts.id });
  return deleted.length > 0;
}

/**
 * CRUD over `athlete_facts`, every query scoped by the athlete's id. None of
 * it uses the instance, so the methods are module functions bound here, as
 * UserStorage binds its own: storage.athleteFacts.X() and its mocks still work.
 */
export class AthleteFactsStorage {
  readonly list = listAthleteFacts;
  readonly listActive = listActiveAthleteFacts;
  readonly add = addAthleteFact;
  readonly seed = seedAthleteFacts;
  readonly update = updateAthleteFact;
  readonly delete = deleteAthleteFact;
}
