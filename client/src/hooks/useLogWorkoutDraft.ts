import type { StructuredExercise } from "@/components/ExerciseInput";

const DRAFT_STORAGE_KEY = "fitai-log-workout-draft";
const DRAFT_ANNOUNCED_KEY = "fitai-log-workout-draft-announced";
const DRAFT_VERSION = 1;

/**
 * Serializable shape of an in-progress workout log so the user doesn't lose
 * work if they accidentally navigate away before saving.
 */
export interface LogWorkoutDraft {
  version: number;
  userKey: string;
  savedAt: number;
  title: string;
  date: string;
  freeText: string;
  notes: string;
  rpe: number | null;
  useTextMode: boolean;
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  blockCounter: number;
}

export type LoadedDraft = Omit<LogWorkoutDraft, "version" | "userKey" | "savedAt">;

function getStorageKey(userKey: string): string {
  return `${DRAFT_STORAGE_KEY}:${userKey}`;
}

function getAnnouncedKey(userKey: string): string {
  return `${DRAFT_ANNOUNCED_KEY}:${userKey}`;
}

function isBlank(draft: LoadedDraft): boolean {
  return (
    draft.title.trim() === "" &&
    draft.freeText.trim() === "" &&
    draft.notes.trim() === "" &&
    draft.rpe === null &&
    draft.exerciseBlocks.length === 0
  );
}

export function loadLogWorkoutDraft(userKey: string): LoadedDraft | null {
  if (globalThis.window === undefined) return null;
  try {
    const raw = globalThis.window.localStorage.getItem(getStorageKey(userKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LogWorkoutDraft;
    if (parsed.version !== DRAFT_VERSION) return null;
    if (parsed.userKey !== userKey) return null;
    return {
      title: parsed.title ?? "",
      date: parsed.date ?? new Date().toISOString().split("T")[0],
      freeText: parsed.freeText ?? "",
      notes: parsed.notes ?? "",
      rpe: parsed.rpe ?? null,
      useTextMode: parsed.useTextMode ?? false,
      exerciseBlocks: parsed.exerciseBlocks ?? [],
      exerciseData: parsed.exerciseData ?? {},
      blockCounter: parsed.blockCounter ?? 0,
    };
  } catch {
    return null;
  }
}

export function saveLogWorkoutDraft(userKey: string, draft: LoadedDraft): void {
  if (globalThis.window === undefined) return;
  // Don't persist an empty draft — that would just create noise.
  if (isBlank(draft)) {
    clearLogWorkoutDraft(userKey);
    return;
  }
  const payload: LogWorkoutDraft = {
    version: DRAFT_VERSION,
    userKey,
    savedAt: Date.now(),
    ...draft,
  };
  try {
    globalThis.window.localStorage.setItem(getStorageKey(userKey), JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — best-effort only, fail silently.
  }
}

export function clearLogWorkoutDraft(userKey: string): void {
  if (globalThis.window === undefined) return;
  try {
    globalThis.window.localStorage.removeItem(getStorageKey(userKey));
  } catch {
    // ignore
  }
  // Reset the session-scoped "already announced" flag so the next draft the
  // user creates will be announced again when it's restored.
  try {
    globalThis.window.sessionStorage.removeItem(getAnnouncedKey(userKey));
  } catch {
    // ignore
  }
}

/**
 * Returns true if the "Draft restored" toast has already been shown for this
 * user in the current browser session. Scoped to sessionStorage so it
 * survives in-app navigation and tab reloads but resets on tab close.
 */
export function hasAnnouncedDraftRestore(userKey: string): boolean {
  if (globalThis.window === undefined) return false;
  try {
    return (
      globalThis.window.sessionStorage.getItem(getAnnouncedKey(userKey)) !==
      null
    );
  } catch {
    return false;
  }
}

/**
 * Marks the draft-restore toast as shown for this user in the current session
 * so repeated mounts of LogWorkoutForm don't re-announce the same draft.
 */
export function markAnnouncedDraftRestore(userKey: string): void {
  if (globalThis.window === undefined) return;
  try {
    globalThis.window.sessionStorage.setItem(getAnnouncedKey(userKey), "1");
  } catch {
    // Session storage disabled / quota exceeded — best-effort only.
  }
}
