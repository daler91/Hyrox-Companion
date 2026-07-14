import { calculateMafHr } from "@shared/maf";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildRecalculationSummary,
  type StyleAuditEntry,
} from "@/components/settings/TrainingStyleSection";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import {
  type ActivityLevelValue,
  ageInputToSnapshot,
  DEFAULT_PREFERENCES_DRAFT,
  DEFAULT_PREFERENCES_SNAPSHOT,
  draftToSnapshot,
  mafHrDataAvailableInputToSnapshot,
  type PreferencesDraft,
  type PreferencesSnapshot,
  preferencesToDraft,
  preferencesToSnapshot,
  type SavePayload,
  savePayloadToSnapshot,
  snapshotToDraft,
  snapshotToSavePayload,
  type WeightGoalDirectionValue,
} from "./preferencesSnapshot";

const STYLE_AUDIT_STORAGE_KEY = "fitai-settings-style-audit";

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
  // Snapshot of values before the most recent save, used to offer an
  // "Undo" action on the post-save toast.
  const undoSnapshotRef = useRef<PreferencesSnapshot | null>(null);
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
    if (preferences) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(preferencesToDraft(preferences));
      // Seed the baseline snapshot on first load. After saves, onSuccess
      // keeps the baseline in sync with committed values.
      if (!baselineSnapshotRef.current) {
        baselineSnapshotRef.current = preferencesToSnapshot(preferences);
      }
    }
  }, [preferences]);

  useEffect(() => {
    const baseline = baselineSnapshotRef.current ?? DEFAULT_PREFERENCES_SNAPSHOT;
    setHasChanges(JSON.stringify(draftToSnapshot(draft)) !== JSON.stringify(baseline));
  }, [draft]);

  const saveMutation = useMutation({
    mutationFn: (data: SavePayload) => api.preferences.update(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
      // Promote the saved values to the dirty-state baseline so we don't
      // depend on the invalidating preferences query timing.
      baselineSnapshotRef.current = savePayloadToSnapshot(variables);
      setHasChanges(false);
      if (pendingStyleAuditRef.current) {
        const nextAudit = [pendingStyleAuditRef.current, ...styleAuditEntries].slice(0, 10);
        setStyleAuditEntries(nextAudit);
        localStorage.setItem(STYLE_AUDIT_STORAGE_KEY, JSON.stringify(nextAudit));
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
              setDraft(snapshotToDraft(previous));
              saveMutation.mutate(snapshotToSavePayload(previous));
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: () => {
      pendingStyleAuditRef.current = null;
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
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
    const mafConsistency = draft.mafConsistencyInput || null;
    const mafTrend = draft.mafTrendInput || null;
    const mafHrDataAvailable = mafHrDataAvailableInputToSnapshot(draft.mafHrDataAvailableInput);
    const hasValidMafInputs =
      mafAge != null && mafAge >= 16 && mafAge <= 99 && Boolean(mafConsistency) && Boolean(mafTrend);

    if (draft.trainingStyleId === "maf_method" && !hasValidMafInputs) {
      toast({
        title: "Complete MAF setup",
        description: "Enter a valid age and select the required MAF fields before saving.",
        variant: "destructive",
      });
      return;
    }

    // Capture the pre-save baseline so the post-save toast can offer Undo.
    undoSnapshotRef.current = baselineSnapshotRef.current
      ? { ...baselineSnapshotRef.current }
      : null;
    const committedStyleId = baselineSnapshotRef.current?.trainingStyleId ?? "balanced_default";
    const styleChanged = draft.trainingStyleId !== committedStyleId;
    const maf = draft.trainingStyleId === "maf_method" && hasValidMafInputs ? calculateMafHr({
      age: mafAge,
      injuryIllnessMedication: Boolean(preferences?.mafInjuryIllnessMedication),
      consistency: mafConsistency!,
      trend: mafTrend!,
    }) : null;
    pendingStyleAuditRef.current = styleChanged
      ? {
          changedAtIso: new Date().toISOString(),
          fromStyleId: committedStyleId,
          toStyleId: draft.trainingStyleId,
          recalculations: buildRecalculationSummary(draft.trainingStyleId),
        }
      : null;
    saveMutation.mutate({
      weightUnit: draft.weightUnit,
      distanceUnit: draft.distanceUnit,
      division: draft.division,
      gender: draft.gender,
      age: ageInputToSnapshot(draft.ageInput),
      bodyweightKg: draft.bodyweightKg,
      heightCm: draft.heightCm,
      restingHr: ageInputToSnapshot(draft.restingHrInput),
      maxHr: ageInputToSnapshot(draft.maxHrInput),
      ftp: ageInputToSnapshot(draft.ftpInput),
      activityLevel: (draft.activityLevel || null) as ActivityLevelValue | null,
      weightGoalDirection: (draft.weightGoalDirection || null) as WeightGoalDirectionValue | null,
      weightGoalRateKgPerWeek: draft.weightGoalRateKgPerWeek,
      weeklyGoal: Number.parseInt(draft.weeklyGoal, 10),
      mealSchedule: draft.mealSchedule,
      emailNotifications: draft.emailNotifications,
      emailWeeklySummary: draft.emailWeeklySummary,
      emailMissedReminder: draft.emailMissedReminder,
      showAdherenceInsights: draft.showAdherenceInsights,
      aiCoachEnabled: draft.aiCoachEnabled,
      coachAutoApplyPlanChanges: draft.coachAutoApplyPlanChanges,
      trainingStyleId: draft.trainingStyleId,
      trainingStylePreviousId: styleChanged ? committedStyleId : undefined,
      trainingStyleChangedAt: styleChanged ? new Date().toISOString() : undefined,
      trainingStyleRecomputeNow: styleChanged,
      mafAge,
      mafConsistency,
      mafTrend,
      mafHrDataAvailable,
      mafHr: draft.trainingStyleId === "maf_method" ? maf?.ceiling : undefined,
      mafBaselineTestScheduledAt: styleChanged && draft.trainingStyleId === "maf_method" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined,
    });
  }, [saveMutation, draft, preferences?.mafInjuryIllnessMedication, toast]);

  const mafAgeValue = ageInputToSnapshot(draft.mafAgeInput);
  const hasRequiredMafInputs =
    mafAgeValue != null &&
    mafAgeValue >= 16 &&
    mafAgeValue <= 99 &&
    Boolean(draft.mafConsistencyInput) &&
    Boolean(draft.mafTrendInput);

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
