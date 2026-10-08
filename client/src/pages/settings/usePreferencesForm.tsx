import { calculateMafHr } from "@shared/maf";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildRecalculationSummary,
  type StyleAuditEntry,
} from "@/components/settings/TrainingStyleSection";
import { ToastAction } from "@/components/ui/toast";
import { ignoreResult } from "@/hooks/chat/chatSessionModel";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { parseApiError } from "@/lib/apiError";
import { queryClient } from "@/lib/queryClient";
import { safeLocalStorage } from "@/lib/safeStorage";
import { WORKOUT_DERIVED_NUTRITION_QUERY_KEYS } from "@/lib/workoutInvalidation";

import {
  ageInputToSnapshot,
  DEFAULT_PREFERENCES_DRAFT,
  DEFAULT_PREFERENCES_SNAPSHOT,
  draftToSnapshot,
  type PreferencesDraft,
  type PreferencesSnapshot,
  preferencesToDraft,
  preferencesToSnapshot,
  type SavePayload,
  savePayloadToSnapshot,
  snapshotToDraft,
  snapshotToSavePayload,
} from "./preferencesSnapshot";
import { describeInvalidPreferences, describePreferencesRejection } from "./preferencesValidation";

const STYLE_AUDIT_STORAGE_KEY = "fitai-settings-style-audit";

/**
 * Whether a save recomputes the MAF ceiling (and so needs a valid age and
 * category). Accounts on MAF from before audit M6 have no category, since
 * migration 0090 did not backfill one: a change of units or a notification
 * toggle was refused until they answered it, which also rewrote their
 * ceiling. Their stored ceiling now stands until they change what sets it
 * (switching to MAF, the age or the category). CL34 (CODEBASE_ANALYSIS_2026-10-03)
 */
function recomputesMafCeiling(
  draft: PreferencesDraft,
  committed: PreferencesSnapshot | null,
): boolean {
  if (draft.trainingStyleId !== "maf_method") return false;
  if (draft.mafCategoryInput || !committed) return true;
  return (
    committed.trainingStyleId !== "maf_method" ||
    committed.mafCategory != null ||
    ageInputToSnapshot(draft.mafAgeInput) !== committed.mafAge
  );
}

/**
 * Whether the server would refuse this save as MAF_SETUP_REQUIRED (its
 * validateMafTransition): on MAF it needs an age, and a category unless the
 * legacy consistency/trend pair is stored. recomputesMafCeiling lets a
 * legacy account without a category save, so one without that pair, or
 * without an age, got the generic "Failed to save settings" instead of the
 * MAF prompt.
 * CL34 (CODEBASE_ANALYSIS_2026-10-03)
 */
function serverNeedsMafSetup(
  draft: PreferencesDraft,
  stored: UserPreferences | undefined,
): boolean {
  if (draft.trainingStyleId !== "maf_method") return false;
  if (ageInputToSnapshot(draft.mafAgeInput) == null) return true;
  return !draft.mafCategoryInput && (stored?.mafConsistency == null || stored.mafTrend == null);
}

/** Whether a failed save was the server's MAF_SETUP_REQUIRED (CL34). */
function isMafSetupRequired(error: unknown): boolean {
  return parseApiError(error)?.code === "MAF_SETUP_REQUIRED";
}

const MAF_SETUP_TOAST = {
  title: "Complete MAF setup",
  description: "Enter a valid age and select the required MAF fields before saving.",
  variant: "destructive",
} as const;

/**
 * The reads the server converts into the athlete's units. A units change
 * relabelled their cached numbers without refetching them, so for their
 * staleTime a 100 kg PR read "100 lbs". Exercise history is not here: its
 * rows keep the unit they were logged in and the client converts them.
 * CL67 (CODEBASE_ANALYSIS_2026-10-03)
 */
const UNIT_CONVERTED_QUERY_KEYS = [
  QUERY_KEYS.personalRecords,
  QUERY_KEYS.exerciseAnalytics,
  QUERY_KEYS.trainingOverview,
] as const;

/** Whether a save changed the weight or distance unit (CL67). */
function unitsChanged(before: PreferencesSnapshot | null, saved: PreferencesSnapshot): boolean {
  if (!before) return true;
  return before.weightUnit !== saved.weightUnit || before.distanceUnit !== saved.distanceUnit;
}

/** Refreshes the reads a saved preference feeds. */
function invalidateAfterPreferencesSave(withUnitConverted: boolean): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(ignoreResult);
  // Session grades are measured against max/resting HR, age and units:
  // re-grade everything, closed Weekly Review weeks included.
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessionGradesPrefix }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: ["/api/v1/weekly-review"] }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(ignoreResult);
  // The bodyweight, heart rates, units and meal schedule saved here size
  // session fuelling, the day's meal targets and energy balance, and the
  // training load behind the chips and the Fuelling block: a new weight
  // left them on the old figures for their staleTime.
  // CL19 (CODEBASE_ANALYSIS_2026-10-03)
  for (const queryKey of WORKOUT_DERIVED_NUTRITION_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey }).catch(ignoreResult);
  }
  if (!withUnitConverted) return;
  for (const queryKey of UNIT_CONVERTED_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey }).catch(ignoreResult);
  }
}

/** Whether the draft differs from a committed baseline. */
function isDirtyAgainst(draft: PreferencesDraft, baseline: PreferencesSnapshot): boolean {
  return JSON.stringify(draftToSnapshot(draft)) !== JSON.stringify(baseline);
}

/** Whether the athlete edited the form after a save sent the draft `sent` (CL68). */
function editedSinceSave(current: PreferencesDraft, sent: PreferencesDraft | null): boolean {
  return sent !== null && JSON.stringify(current) !== JSON.stringify(sent);
}

/** The MAF ceiling the server holds (null when it has none). */
interface CommittedMaf {
  readonly mafHr: number | null;
}

/** What the post-save Undo restores. */
interface UndoTarget {
  readonly snapshot: PreferencesSnapshot;
  /** The ceiling stored before the save; null when it was never read. */
  readonly committedMaf: CommittedMaf | null;
}

/**
 * The save that puts `previous` back. The snapshot holds the MAF age and
 * category but not the ceiling computed from them, so undoing a save that
 * moved the ceiling restored the inputs and left the undone ceiling in force
 * for session grading and MAF compliance. A save that sent mafHr is now
 * undone with the ceiling stored before it.
 * CL69 (CODEBASE_ANALYSIS_2026-10-03)
 */
function undoPayload(previous: UndoTarget, undone: SavePayload): SavePayload {
  const payload = snapshotToSavePayload(previous.snapshot);
  if (undone.mafHr === undefined || !previous.committedMaf) return payload;
  return { ...payload, mafHr: previous.committedMaf.mafHr };
}

// Owns the Settings preferences form: the draft state behind every
// controlled field, snapshot-equality dirty tracking, the save mutation
// with its Undo toast, and MAF validation. The page component renders
// layout/tabs and threads `draft` + `updateField` into the section cards.
export function usePreferencesForm() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<PreferencesDraft>(DEFAULT_PREFERENCES_DRAFT);
  const [hasChanges, setHasChanges] = useState(false);
  const [styleAuditEntries, setStyleAuditEntries] = useState<StyleAuditEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STYLE_AUDIT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as StyleAuditEntry[];
      return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  // Snapshot of the last server-committed values used as the baseline for
  // dirty-state computation. Falls back to DEFAULT_PREFERENCES_SNAPSHOT if
  // remote preferences never load (e.g. query error) so edits can still
  // surface the sticky save bar.
  const baselineSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  // Mirror of `hasChanges` readable from the preferences effect without
  // re-running it on every keystroke.
  const hasChangesRef = useRef(false);
  // The live draft, and the one the in-flight save sent, so a save that
  // lands can tell whether the athlete kept editing meanwhile (CL68).
  const draftRef = useRef(draft);
  const savingDraftRef = useRef<PreferencesDraft | null>(null);
  // The MAF ceiling the server holds: the snapshot does not carry it, and an
  // Undo has to put it back (CL69).
  const committedMafRef = useRef<CommittedMaf | null>(null);
  // Values before the most recent save, used to offer an "Undo" action on
  // the post-save toast.
  const undoSnapshotRef = useRef<UndoTarget | null>(null);
  const pendingStyleAuditRef = useRef<StyleAuditEntry | null>(null);

  const updateField = useCallback(
    <K extends keyof PreferencesDraft>(key: K, value: PreferencesDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const {
    data: preferences,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<UserPreferences>({
    queryKey: QUERY_KEYS.preferences,
  });

  useEffect(() => {
    if (!preferences) return;
    committedMafRef.current = { mafHr: preferences.mafHr ?? null };
    // A refetch that lands mid-edit (window focus, another tab's save, the
    // post-save invalidation racing a fresh keystroke) must not wipe what the
    // athlete has typed: while the draft is dirty only the baseline is seeded
    // if it never was, and the draft re-syncs on the next clean refetch.
    if (hasChangesRef.current) {
      baselineSnapshotRef.current ??= preferencesToSnapshot(preferences);
      return;
    }
    // Clean: the server row IS the committed state, so both move together.
    baselineSnapshotRef.current = preferencesToSnapshot(preferences);
    setDraft(preferencesToDraft(preferences));
  }, [preferences]);

  useEffect(() => {
    draftRef.current = draft;
    const dirty = isDirtyAgainst(
      draft,
      baselineSnapshotRef.current ?? DEFAULT_PREFERENCES_SNAPSHOT,
    );
    hasChangesRef.current = dirty;
    setHasChanges(dirty);
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: (data: SavePayload) => api.preferences.update(data),
    onSuccess: (_data, variables) => {
      const saved = savePayloadToSnapshot(variables);
      invalidateAfterPreferencesSave(unitsChanged(baselineSnapshotRef.current, saved));
      // Promote the saved values to the dirty-state baseline so we don't
      // depend on the invalidating preferences query timing.
      baselineSnapshotRef.current = saved;
      if (variables.mafHr !== undefined) committedMafRef.current = { mafHr: variables.mafHr };
      // An edit made while the save was in flight stays dirty: clearing the
      // flag let the post-save refetch overwrite it and took the Save bar
      // away with it. CL68 (CODEBASE_ANALYSIS_2026-10-03)
      const current = draftRef.current;
      const stillDirty =
        editedSinceSave(current, savingDraftRef.current) && isDirtyAgainst(current, saved);
      hasChangesRef.current = stillDirty;
      setHasChanges(stillDirty);
      if (pendingStyleAuditRef.current) {
        const nextAudit = [pendingStyleAuditRef.current, ...styleAuditEntries].slice(0, 10);
        setStyleAuditEntries(nextAudit);
        // Guarded: this runs inside the mutation's onSuccess, so a storage
        // exception (quota, blocked storage) would otherwise flip a save the
        // server already accepted into the "Failed to save settings" toast.
        safeLocalStorage.setItem(STYLE_AUDIT_STORAGE_KEY, JSON.stringify(nextAudit));
        pendingStyleAuditRef.current = null;
      }
      const previous = undoSnapshotRef.current;
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated.",
        action: previous ? (
          <ToastAction
            altText="Undo settings change"
            data-testid="button-undo-settings"
            onClick={() => {
              // Restore the previous values in-state and persist them.
              // Leave undoSnapshotRef in place so a second undo restores
              // again — the mutation onSuccess will replace it after
              // persistence completes.
              const restored = snapshotToDraft(previous.snapshot);
              setDraft(restored);
              savingDraftRef.current = restored;
              saveMutation.mutate(undoPayload(previous, variables));
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (saveError) => {
      pendingStyleAuditRef.current = null;
      if (isMafSetupRequired(saveError)) {
        toast(MAF_SETUP_TOAST);
        return;
      }
      // A refusal names the field rather than asking for a retry that fails
      // the same way. U35 (CODEBASE_ANALYSIS_2026-10-03)
      const rejection = describePreferencesRejection(saveError);
      toast({
        title: rejection ? "Check your settings" : "Error",
        description: rejection ?? "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Warn user before leaving with unsaved changes
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    globalThis.window.addEventListener("beforeunload", handler);
    return () => globalThis.window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  const handleSave = useCallback(() => {
    const mafAge = ageInputToSnapshot(draft.mafAgeInput);
    // Maffetone's category question, read from the DRAFT for the same reason
    // the old injury flag was: the answer moves the ceiling and must never be
    // write-once (a healed injury, a second training anniversary). Legacy
    // accounts without a category keep their stored proxy-derived ceiling
    // until they answer it — the save payload omits the proxy fields entirely,
    // and mafHr too unless the ceiling is recomputed (audit M6, CL34).
    const mafCategory = draft.mafCategoryInput || null;
    const hasValidMafInputs = mafAge != null && mafAge >= 16 && mafAge <= 99 && mafCategory != null;
    const recomputeMaf = recomputesMafCeiling(draft, baselineSnapshotRef.current);

    if ((recomputeMaf && !hasValidMafInputs) || serverNeedsMafSetup(draft, preferences)) {
      toast(MAF_SETUP_TOAST);
      return;
    }

    const committedStyleId = baselineSnapshotRef.current?.trainingStyleId ?? "balanced_default";
    const styleChanged = draft.trainingStyleId !== committedStyleId;
    const maf =
      recomputeMaf && hasValidMafInputs
        ? calculateMafHr({ age: mafAge, category: mafCategory })
        : null;
    // The recurring field mappings live in snapshotToSavePayload; only the
    // save-time-only style/MAF bookkeeping is added here.
    const payload: SavePayload = {
      ...snapshotToSavePayload(draftToSnapshot(draft)),
      trainingStylePreviousId: styleChanged ? committedStyleId : undefined,
      trainingStyleChangedAt: styleChanged ? new Date().toISOString() : undefined,
      trainingStyleRecomputeNow: styleChanged,
      mafHr: maf?.ceiling,
      mafBaselineTestScheduledAt:
        styleChanged && draft.trainingStyleId === "maf_method"
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
    };
    // Refuse here, naming the field, what the server's schema would refuse
    // as a whole. U35 (CODEBASE_ANALYSIS_2026-10-03)
    const invalid = describeInvalidPreferences(payload, draft.weightUnit);
    if (invalid) {
      toast({ title: "Check your settings", description: invalid, variant: "destructive" });
      return;
    }

    // Capture the pre-save baseline so the post-save toast can offer Undo.
    undoSnapshotRef.current = baselineSnapshotRef.current
      ? { snapshot: { ...baselineSnapshotRef.current }, committedMaf: committedMafRef.current }
      : null;
    pendingStyleAuditRef.current = styleChanged
      ? {
          changedAtIso: new Date().toISOString(),
          fromStyleId: committedStyleId,
          toStyleId: draft.trainingStyleId,
          recalculations: buildRecalculationSummary(draft.trainingStyleId),
        }
      : null;
    savingDraftRef.current = draft;
    saveMutation.mutate(payload);
  }, [saveMutation, draft, preferences, toast]);

  const mafAgeValue = ageInputToSnapshot(draft.mafAgeInput);
  const hasRequiredMafInputs =
    mafAgeValue != null &&
    mafAgeValue >= 16 &&
    mafAgeValue <= 99 &&
    Boolean(draft.mafCategoryInput);

  return {
    draft,
    updateField,
    hasChanges,
    styleAuditEntries,
    hasRequiredMafInputs,
    handleSave,
    isSaving: saveMutation.isPending,
    preferences,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  };
}
