/**
 * Rebuild the vector DB from the primary DB — the "rebuild instead of restore"
 * fallback in docs/operations/backup-restore.md §5.3.
 *
 * That section is the whole reason the vector DB is classed as low-criticality:
 * every chunk is derivable from `coaching_materials`, so losing it costs an
 * embedding re-run rather than user data. But the only re-embed entry point was
 * `reembedAllMaterials(userId)` behind an authenticated HTTP route, scoped to
 * one user — so the documented recovery path meant signing in as every affected
 * athlete in turn. This is the operator-facing version.
 *
 * Usage:
 *   pnpm ops:reembed [--user <id>] [--dry-run] [--verify-only]
 *
 * Flags:
 *   --user <id>    Restrict to one athlete instead of everyone with materials.
 *   --dry-run      Report what would be re-embedded; no provider calls, no writes.
 *   --verify-only  Skip the rebuild and just report chunk coverage — run this
 *                  first after a vector restore to find out whether a rebuild
 *                  is needed at all.
 *
 * Requires DATABASE_URL, VECTOR_DATABASE_URL (when split), and GEMINI_API_KEY.
 * Re-embedding is idempotent: `embedCoachingMaterial` replaces a material's
 * chunks transactionally, so an interrupted run is safe to repeat and there is
 * no need to drop `document_chunks` first.
 *
 * Exits non-zero if any material failed to embed or is still without chunks.
 */
import { coachingMaterials } from "@shared/schema";

import { db, pool } from "../server/db";
import { env } from "../server/env";
import { ensurePgvectorExtension, ensureVectorSchema, getVectorSchemaStatus } from "../server/maintenance";
import { reembedAllMaterials } from "../server/services/ragService";
import { storage } from "../server/storage";
import { vectorPool } from "../server/vectorDb";

export interface Flags {
  userId?: string;
  dryRun: boolean;
  verifyOnly: boolean;
}

/**
 * Strict on purpose: an unrecognised flag throws rather than being ignored.
 * A typo like `--dryrun` silently starting a live fleet-wide rebuild is the
 * one mistake this command really must not allow.
 */
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { dryRun: false, verifyOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--verify-only") flags.verifyOnly = true;
    else if (arg === "--user") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--user needs an athlete id");
      flags.userId = value;
    } else throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

/** Athletes who actually own coaching materials — not every user in the DB. */
async function targetUserIds(flags: Flags): Promise<string[]> {
  if (flags.userId) return [flags.userId];
  const rows = await db.selectDistinct({ userId: coachingMaterials.userId }).from(coachingMaterials);
  return rows.map((r) => r.userId).sort();
}

interface UserOutcome {
  userId: string;
  materials: number;
  embedded: number;
  errors: string[];
  /** Materials still holding zero chunks after the run — the real success test. */
  unembedded: string[];
}

/**
 * Chunk coverage read back from the vector DB. `reembedAllMaterials` reporting
 * success only means the calls resolved; this is what proves the vectors landed.
 */
async function verifyCoverage(userId: string): Promise<string[]> {
  const materials = await storage.coaching.listCoachingMaterials(userId);
  let counts: { materialId: string; chunkCount: number; hasEmbeddings: boolean }[];
  try {
    counts = await storage.coaching.getChunkCountsByMaterial(userId);
  } catch (err) {
    // A bare vector DB has no document_chunks at all. That is a meaningful
    // answer to "do I need a rebuild?" rather than an internal error, so say
    // so plainly instead of surfacing a raw relation-missing message.
    if (err instanceof Error && /document_chunks.*does not exist/i.test(err.message)) {
      throw new Error(
        "the vector DB has no document_chunks table — run without --verify-only to create the schema and rebuild",
        { cause: err },
      );
    }
    throw err;
  }
  const byId = new Map(counts.map((c) => [c.materialId, c]));
  return materials
    .filter((m) => {
      const entry = byId.get(m.id);
      return !entry || entry.chunkCount === 0 || !entry.hasEmbeddings;
    })
    .map((m) => `${m.id} (${m.title})`);
}

async function processUser(userId: string, flags: Flags): Promise<UserOutcome> {
  const materials = await storage.coaching.listCoachingMaterials(userId);
  if (flags.dryRun) {
    return { userId, materials: materials.length, embedded: 0, errors: [], unembedded: [] };
  }
  if (flags.verifyOnly) {
    return { userId, materials: materials.length, embedded: 0, errors: [], unembedded: await verifyCoverage(userId) };
  }
  // Per-user, not per-material: reembedAllMaterials already applies its own
  // concurrency limit internally, and users are walked one at a time so a
  // whole-fleet rebuild does not stampede the embedding provider's rate limit.
  const result = await reembedAllMaterials(userId);
  return {
    userId,
    materials: materials.length,
    embedded: result.materialsProcessed,
    errors: result.errors,
    unembedded: await verifyCoverage(userId),
  };
}

/** A live rebuild — neither of the two read-only modes. */
function isRebuild(flags: Flags): boolean {
  return !flags.dryRun && !flags.verifyOnly;
}

function describeMode(flags: Flags): string {
  if (flags.dryRun) return "dry run";
  if (flags.verifyOnly) return "verify only";
  return "re-embedding";
}

function resolveFlags(): Flags {
  try {
    return parseFlags(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

/**
 * Makes this a complete §5.3 rebuild: an operator pointing at a freshly
 * restored (or freshly created) vector DB should not have to boot the app once
 * just to get the tables. Same code path boot uses, so there is one definition
 * of the vector schema, not two. False means nothing can be re-embedded.
 */
async function prepareVectorSchema(): Promise<boolean> {
  await ensurePgvectorExtension();
  await ensureVectorSchema();
  const status = getVectorSchemaStatus();
  if (status === "failed") {
    console.error("Vector schema setup failed — see the logged error above. Nothing was re-embedded.");
    return false;
  }
  console.log(`Vector schema: ${status}${status === "degraded" ? " (no HNSW index — search will be a sequential scan; needs pgvector >= 0.7.0)" : ""}`);
  return true;
}

function reportUserOutcome(outcome: UserOutcome, flags: Flags): void {
  const parts = [`${outcome.materials} material(s)`];
  if (isRebuild(flags)) parts.push(`${outcome.embedded} embedded`);
  if (outcome.errors.length > 0) parts.push(`${outcome.errors.length} error(s)`);
  if (outcome.unembedded.length > 0) parts.push(`${outcome.unembedded.length} still without chunks`);
  console.log(`  ${outcome.userId}: ${parts.join(", ")}`);
  for (const error of outcome.errors) console.log(`      error: ${error}`);
  for (const missing of outcome.unembedded) console.log(`      no chunks: ${missing}`);
}

/**
 * Never let one athlete's failure end the fleet-wide rebuild: a DR run that
 * stops at the first bad material leaves everyone after it unfixed.
 */
async function runFleet(userIds: string[], flags: Flags): Promise<UserOutcome[]> {
  const outcomes: UserOutcome[] = [];
  for (const userId of userIds) {
    try {
      const outcome = await processUser(userId, flags);
      outcomes.push(outcome);
      reportUserOutcome(outcome, flags);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ userId, materials: 0, embedded: 0, errors: [message], unembedded: [] });
      console.log(`  ${userId}: FAILED — ${message}`);
    }
  }
  return outcomes;
}

/** Prints the tail summary; false when the run left work for an operator. */
function printSummary(
  outcomes: UserOutcome[],
  flags: Flags,
  mode: string,
  startedAt: number,
): boolean {
  const materials = outcomes.reduce((sum, o) => sum + o.materials, 0);
  const embedded = outcomes.reduce((sum, o) => sum + o.embedded, 0);
  const errors = outcomes.reduce((sum, o) => sum + o.errors.length, 0);
  const missing = outcomes.reduce((sum, o) => sum + o.unembedded.length, 0);

  console.log(
    `\n${mode}: ${outcomes.length} athlete(s), ${materials} material(s)` +
    (flags.dryRun ? "" : `, ${embedded} embedded`) +
    `, ${errors} error(s), ${missing} without chunks — ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  if (flags.dryRun) console.log("Dry run: nothing was written. Re-run without --dry-run to rebuild.");
  return errors === 0 && missing === 0;
}

/** Walk the fleet, always closing the pools. Null means nothing ran at all. */
async function collectOutcomes(flags: Flags, mode: string): Promise<UserOutcome[] | null> {
  try {
    if (isRebuild(flags) && !(await prepareVectorSchema())) return null;

    const userIds = await targetUserIds(flags);
    console.log(`${userIds.length} athlete(s) with coaching materials — ${mode}\n`);

    return await runFleet(userIds, flags);
  } finally {
    await pool.end();
    // Separate pool in split-DB mode; the same one in single-DB mode, where
    // ending it twice is a no-op.
    await vectorPool.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const flags = resolveFlags();

  // Fail before touching the DB rather than after half a fleet has been walked.
  if (isRebuild(flags) && !env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set — re-embedding calls the embedding provider.\nUse --dry-run or --verify-only to inspect state without it.");
    process.exit(2);
  }

  const mode = describeMode(flags);
  const startedAt = Date.now();

  const outcomes = await collectOutcomes(flags, mode);
  if (!outcomes) {
    process.exitCode = 1;
    return;
  }

  if (!printSummary(outcomes, flags, mode, startedAt)) process.exitCode = 1;
}

// Importing this module (for tests) must not start a rebuild.
if (process.argv[1]?.endsWith("reembed-materials.ts")) {
  await main();
}
