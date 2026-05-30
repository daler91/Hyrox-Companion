import type { GarminConnection,StravaConnection } from "@shared/schema";

import type { IStorage } from "../storage";

interface TimelineEntry {
  workoutLogId?: string | null;
  date?: string | null;
  type?: string | null;
  status?: string | null;
  focus?: string | null;
  mainWorkout?: string | null;
  accessory?: string | null;
  notes?: string | null;
  duration?: number | null;
  rpe?: number | null;
  exerciseSets?: StructureSetLike[] | null;
}

interface StructureSetLike {
  exerciseName: string;
  customLabel?: string | null;
  stepNumber?: number | null;
  blockId?: string | null;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
}

function structuredSummary(sets: StructureSetLike[] | null | undefined): string | null {
  if (sets == null || sets.length === 0) return null;
  const byBlock = new Map<string, StructureSetLike[]>();
  let legacySegment = 0;
  let previousLegacyName: string | null = null;
  for (const set of sets) {
    let key = set.blockId;
    if (key == null || key.length === 0) {
      const currentLegacyName = set.customLabel || set.exerciseName;
      const hasSameLegacyName = previousLegacyName === currentLegacyName;
      if (hasSameLegacyName === false) {
        legacySegment += 1;
        previousLegacyName = currentLegacyName;
      }
      key = `legacy-${legacySegment}-${currentLegacyName}`;
    } else {
      previousLegacyName = null;
    }
    const arr = byBlock.get(key) ?? [];
    arr.push(set);
    byBlock.set(key, arr);
  }
  const blocks: string[] = [];
  for (const blockSets of byBlock.values()) {
    blockSets.sort((a,b)=>(a.stepNumber ?? 0)-(b.stepNumber ?? 0));
    const parts = blockSets.map((s) => {
      const label = s.customLabel || s.exerciseName;
      const targetParts: string[] = [];
      if (s.reps == null) {
        // no-op
      } else {
        targetParts.push(`${s.reps} reps`);
      }
      if (s.weight == null) {
        // no-op
      } else {
        targetParts.push(`${s.weight}`);
      }
      if (s.distance == null) {
        // no-op
      } else {
        targetParts.push(`${s.distance}m`);
      }
      if (s.time == null) {
        // no-op
      } else {
        targetParts.push(`${s.time}min`);
      }
      const targets = targetParts.join(" · ");
      if (targets.length === 0) return label;
      return `${label} (${targets})`;
    });
    blocks.push(parts.join(" -> "));
  }
  return blocks.join(" | ");
}

interface ExerciseSetRow {
  date: string;
  workoutLogId: string;
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  notes?: string | null;
}

function buildWorkoutLogTitles(timeline: TimelineEntry[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const entry of timeline) {
    if (entry.workoutLogId) titles[entry.workoutLogId] = entry.focus || "";
  }
  return titles;
}

/**
 * Strip third-party OAuth tokens from the Strava connection before export.
 * Tokens stay encrypted at rest specifically so a backup or memory dump
 * doesn't leak them; shipping the decrypted values out through the GDPR
 * data-export endpoint would defeat that purpose. The user owns their
 * Strava account directly — we hold tokens as a proxy, not as primary data.
 */
function scrubStravaConnection(conn: StravaConnection): Omit<StravaConnection, "accessToken" | "refreshToken"> & { tokensRedacted: true } {
  // Pull the secrets out and discard them. Other tooling reads
  // `tokensRedacted: true` as the marker that this object was scrubbed.
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...rest } = conn;
  return { ...rest, tokensRedacted: true };
}

interface ScrubbedGarminConnection {
  garminDisplayName: GarminConnection["garminDisplayName"];
  lastSyncedAt: GarminConnection["lastSyncedAt"];
  lastError: GarminConnection["lastError"];
  tokenExpiresAt: GarminConnection["tokenExpiresAt"];
  createdAt: GarminConnection["createdAt"];
  credentialsRedacted: true;
}

/**
 * Strip the encrypted email/password and OAuth1/OAuth2 token blobs from the
 * Garmin connection before export. The user supplied these credentials
 * directly, so we have them on record — but exporting the ciphertext serves
 * no portability purpose (the key is not exported, by design) and is risky
 * if the export file is later mishandled.
 */
function scrubGarminConnection(conn: GarminConnection): ScrubbedGarminConnection {
  return {
    garminDisplayName: conn.garminDisplayName,
    lastSyncedAt: conn.lastSyncedAt,
    lastError: conn.lastError,
    tokenExpiresAt: conn.tokenExpiresAt,
    createdAt: conn.createdAt,
    credentialsRedacted: true,
  };
}

interface ScrubbedPushSubscription {
  endpoint: string;
}

/**
 * Keep only the user-facing endpoint URL of each push subscription. The
 * `p256dh` / `auth` keys are message-encryption secrets a malicious party
 * could use to push notifications to the user; they're not data the user
 * needs back, so we never include them in the export.
 */
function scrubPushSubscription(sub: { endpoint: string }): ScrubbedPushSubscription {
  return { endpoint: sub.endpoint };
}

export async function generateJSON(userId: string, storage: IStorage) {
  // Fetch everything in parallel — independent queries against tables the
  // user owns. Each helper is already scoped to userId on its own.
  const [
    user,
    timeline,
    plans,
    allExerciseSets,
    chatMessages,
    coachingMaterials,
    customExercises,
    timelineAnnotations,
    stravaConn,
    garminConn,
    pushSubs,
    aiUsageLogs,
  ] = await Promise.all([
    storage.users.getUser(userId),
    storage.timeline.getTimeline(userId),
    storage.plans.listTrainingPlans(userId),
    storage.analytics.getAllExerciseSetsWithDates(userId),
    storage.users.getAllChatMessagesForExport(userId),
    storage.coaching.listCoachingMaterials(userId),
    storage.users.getCustomExercises(userId),
    storage.timelineAnnotations.list(userId),
    storage.users.getStravaConnection(userId),
    storage.users.getGarminConnection(userId),
    storage.push.getSubscriptionsForUser(userId),
    storage.aiUsage.listForUser(userId),
  ]);

  const workoutLogTitles = buildWorkoutLogTitles(timeline);

  const exerciseSetRows = allExerciseSets.map((s: ExerciseSetRow) => ({
    date: s.date,
    workoutTitle: workoutLogTitles[s.workoutLogId] || "",
    exerciseName: s.exerciseName,
    customLabel: s.customLabel,
    category: s.category,
    setNumber: s.setNumber,
    reps: s.reps,
    weight: s.weight,
    distance: s.distance,
    time: s.time,
    notes: s.notes,
  }));

  return {
    // Bump if a future change rearranges or renames top-level keys so
    // downstream consumers (the user, GDPR portability tooling) can detect
    // which schema they're reading.
    exportFormatVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    profile: user ?? null,
    timeline,
    plans,
    exerciseSets: exerciseSetRows,
    chatMessages,
    coachingMaterials,
    customExercises,
    timelineAnnotations,
    connections: {
      strava: stravaConn ? scrubStravaConnection(stravaConn) : null,
      garmin: garminConn ? scrubGarminConnection(garminConn) : null,
    },
    pushSubscriptions: pushSubs.map(scrubPushSubscription),
    aiUsageLogs,
  };
}

const CSV_FORMULA_CHARACTERS = /^[+\-=@|]/;
const CSV_QUOTABLE_CHARACTERS = /[,\n"]/;

function escapeCsv(val: string | null | undefined): string {
  if (val == null) return "";
  const rawStr = String(val);

  // CSV Injection protection: prepend a single quote if the value starts with a character
  // that could be interpreted as a formula in spreadsheet software (=, +, -, @, |).
  const formulaProtected = CSV_FORMULA_CHARACTERS.test(rawStr) ? `'${rawStr}` : rawStr;

  const escaped = formulaProtected.replaceAll('"', '""');
  // If the value contains characters that require quoting (comma, newline, or double quote), wrap it in quotes.
  return CSV_QUOTABLE_CHARACTERS.test(escaped) ? `"${escaped}"` : escaped;
}

function generateTimelineCsvRows(timeline: TimelineEntry[]): string[] {
  const rows: string[] = [];
  for (const entry of timeline) {
    rows.push([
      escapeCsv(entry.date),
      escapeCsv(entry.type),
      escapeCsv(entry.status),
      escapeCsv(entry.focus),
      escapeCsv(structuredSummary(entry.exerciseSets) ?? entry.mainWorkout),
      escapeCsv(entry.accessory),
      escapeCsv(entry.notes),
      entry.duration == null ? "" : String(entry.duration),
      entry.rpe == null ? "" : String(entry.rpe),
    ].join(","));
  }
  return rows;
}

function generateExerciseSetsCsvRows(allExerciseSets: ExerciseSetRow[], workoutLogTitles: Record<string, string>): string[] {
  const rows: string[] = [];
  for (const s of allExerciseSets) {
    rows.push([
      escapeCsv(s.date),
      escapeCsv(workoutLogTitles[s.workoutLogId] || ""),
      escapeCsv(s.customLabel || s.exerciseName),
      escapeCsv(s.category),
      String(s.setNumber),
      s.reps == null ? "" : String(s.reps),
      s.weight == null ? "" : String(s.weight),
      s.distance == null ? "" : String(s.distance),
      s.time == null ? "" : String(s.time),
      escapeCsv(s.notes),
    ].join(","));
  }
  return rows;
}

export async function generateCSV(userId: string, storage: IStorage): Promise<string> {
  const [timeline, allExerciseSets] = await Promise.all([
    storage.timeline.getTimeline(userId),
    storage.analytics.getAllExerciseSetsWithDates(userId),
  ]);

  const csvRows = ["Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE"];
  csvRows.push(...generateTimelineCsvRows(timeline));

  if (allExerciseSets.length > 0) {
    const workoutLogTitles = buildWorkoutLogTitles(timeline);
    csvRows.push(
      "",
      "--- EXERCISE SETS (Per-Set Data) ---",
      "Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes",
      ...generateExerciseSetsCsvRows(allExerciseSets, workoutLogTitles)
    );
  }

  return csvRows.join("\n");
}
