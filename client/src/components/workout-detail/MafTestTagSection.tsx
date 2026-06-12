import { type MafTestMetrics } from "@shared/maf";
import type { WorkoutLog } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { isWorkoutTagged, testWorkoutLogId } from "@/components/analytics/mafTrend.helpers";
import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/hooks/useAuth";
import {
  api,
  type MafTagResponse,
  type MafTestMetricsInput,
  type MafTestsListResponse,
  QUERY_KEYS,
} from "@/lib/api";

import { MafTestForm, type MafTestFormInitial } from "./MafTestForm";
import { DetailSection } from "./shared/DetailSection";

/**
 * "Tag as MAF test" control on the workout review surface. Only shown to
 * MAF-method athletes with a computed ceiling — the server rejects the tag for
 * anyone else. Tagging is idempotent server-side, and we reflect already-tagged
 * state from the cached MAF test list (shared with the Analytics trend tab).
 * Shown for Strava sessions too: a synced run with HR is an ideal MAF test.
 *
 * Tagging and editing both open `MafTestForm`, prefilled from the workout (tag)
 * or the saved test's metrics (edit), so the athlete can correct the HR /
 * duration / distance the compliance score and pace trend are built from.
 */
export function MafTestTagSection({
  workoutLogId,
  workout,
}: {
  readonly workoutLogId: string | null;
  readonly workout?: WorkoutLog | null;
}) {
  const { user } = useAuth();
  const isMaf = user?.trainingStyleId === "maf_method" && user?.mafHr != null;

  const { data } = useQuery<MafTestsListResponse>({
    queryKey: QUERY_KEYS.mafTests,
    queryFn: () => api.mafTests.list(),
    enabled: !!isMaf && !!workoutLogId,
  });

  const [formOpen, setFormOpen] = useState(false);
  // Bumped on each open so the form remounts and re-seeds from the latest
  // `initial` (the keyed remount replaces a setState-in-effect resync).
  const [formNonce, setFormNonce] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openForm = () => {
    setFormNonce((nonce) => nonce + 1);
    setFormOpen(true);
  };

  const tagMutation = useApiMutation<MafTagResponse, Error, MafTestMetricsInput>({
    mutationFn: (metrics) => api.mafTests.tagWorkout(workoutLogId as string, { metrics }),
    invalidateQueries: [QUERY_KEYS.mafTests],
    successToast: "Tagged as MAF test",
    errorToast: "Couldn't tag as MAF test",
    onSuccess: () => setFormOpen(false),
  });

  const updateMutation = useApiMutation<MafTagResponse, Error, MafTestMetricsInput>({
    mutationFn: (metrics) => api.mafTests.updateTest(workoutLogId as string, { metrics }),
    invalidateQueries: [QUERY_KEYS.mafTests],
    successToast: "Updated MAF test",
    errorToast: "Couldn't update MAF test",
    onSuccess: () => setFormOpen(false),
  });

  const untagMutation = useApiMutation({
    mutationFn: () => api.mafTests.untagWorkout(workoutLogId as string),
    invalidateQueries: [QUERY_KEYS.mafTests],
    successToast: "Removed from MAF trend",
    errorToast: "Couldn't remove MAF test",
  });

  if (!isMaf || !workoutLogId) return null;

  const alreadyTagged = isWorkoutTagged(data, workoutLogId);

  // Prefill the form from the saved test's metrics when editing, otherwise from
  // the workout's auto-pulled values when tagging.
  const taggedMetrics: Partial<MafTestMetrics> | null =
    data?.tests.find((t) => testWorkoutLogId(t) === workoutLogId)?.metrics ?? null;
  const initial: MafTestFormInitial = alreadyTagged
    ? {
        avgHeartRate: taggedMetrics?.avgHeartRate ?? null,
        maxHeartRate: taggedMetrics?.maxHeartRate ?? null,
        durationSeconds: taggedMetrics?.durationSeconds ?? null,
        distanceMeters: taggedMetrics?.distanceMeters ?? null,
      }
    : {
        avgHeartRate: workout?.avgHeartrate ?? null,
        maxHeartRate: workout?.maxHeartrate ?? null,
        durationSeconds: workout?.duration ?? null,
        distanceMeters: workout?.distanceMeters ?? null,
      };

  const formPending = alreadyTagged ? updateMutation.isPending : tagMutation.isPending;
  const handleFormSubmit = (metrics: MafTestMetricsInput) => {
    if (alreadyTagged) updateMutation.mutate(metrics);
    else tagMutation.mutate(metrics);
  };

  return (
    <>
      <DetailSection title="MAF test" icon={Activity} testId={`maf-test-tag-${workoutLogId}`}>
        <div className="space-y-2">
          {alreadyTagged ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`maf-test-tagged-${workoutLogId}`}>
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                Tracked in your MAF trend
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openForm}
                  data-testid={`maf-test-edit-button-${workoutLogId}`}
                >
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={untagMutation.isPending}
                  data-testid={`maf-test-untag-button-${workoutLogId}`}
                >
                  {untagMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Tag this run as a MAF test to track your pace at the same heart rate over time.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={openForm}
                data-testid={`maf-test-tag-button-${workoutLogId}`}
              >
                <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
                Tag as MAF test
              </Button>
            </>
          )}
        </div>
      </DetailSection>
      <MafTestForm
        key={formNonce}
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={alreadyTagged ? "edit" : "create"}
        initial={initial}
        isPending={formPending}
        onSubmit={handleFormSubmit}
        testId={`maf-test-form-${workoutLogId}`}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove MAF test?"
        description="This removes the workout from your MAF trend, including its compliance score. You can tag it again later."
        confirmText="Remove"
        onConfirm={() => untagMutation.mutate()}
        isPending={untagMutation.isPending}
        isDestructive
        confirmTestId={`maf-test-untag-confirm-${workoutLogId}`}
      />
    </>
  );
}
