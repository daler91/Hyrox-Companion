import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, Loader2 } from "lucide-react";

import { isWorkoutTagged } from "@/components/analytics/mafTrend.helpers";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/hooks/useAuth";
import { api, type MafTestsListResponse, QUERY_KEYS } from "@/lib/api";

/**
 * "Tag as MAF test" control on the workout review surface. Only shown to
 * MAF-method athletes with a computed ceiling — the server rejects the tag for
 * anyone else. Tagging is idempotent server-side, and we reflect already-tagged
 * state from the cached MAF test list (shared with the Analytics trend tab).
 * Shown for Strava sessions too: a synced run with HR is an ideal MAF test.
 */
export function MafTestTagSection({ workoutLogId }: { readonly workoutLogId: string | null }) {
  const { user } = useAuth();
  const isMaf = user?.trainingStyleId === "maf_method" && user?.mafHr != null;

  const { data } = useQuery<MafTestsListResponse>({
    queryKey: QUERY_KEYS.mafTests,
    queryFn: () => api.mafTests.list(),
    enabled: !!isMaf && !!workoutLogId,
  });

  const tagMutation = useApiMutation({
    mutationFn: () => api.mafTests.tagWorkout(workoutLogId as string),
    invalidateQueries: [QUERY_KEYS.mafTests],
    successToast: "Tagged as MAF test",
    errorToast: "Couldn't tag as MAF test",
  });

  if (!isMaf || !workoutLogId) return null;

  const alreadyTagged = isWorkoutTagged(data, workoutLogId);

  return (
    <>
      <Separator />
      <section className="space-y-2" data-testid={`maf-test-tag-${workoutLogId}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">MAF test</p>
        {alreadyTagged ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`maf-test-tagged-${workoutLogId}`}>
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            Tracked in your MAF trend
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Tag this run as a MAF test to track your pace at the same heart rate over time.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => tagMutation.mutate()}
              disabled={tagMutation.isPending}
              data-testid={`maf-test-tag-button-${workoutLogId}`}
            >
              {tagMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Tag as MAF test
            </Button>
          </>
        )}
      </section>
    </>
  );
}
