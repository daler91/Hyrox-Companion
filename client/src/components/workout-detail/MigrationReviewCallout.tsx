import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiRequest, humanizeApiError } from "@/lib/queryClient";

export type MigrationReviewAction = "accept" | "reject" | "edit";

/** An open review flag on one workout's converted exercise rows. */
export interface MigrationReviewFlag {
  readonly ownerId: string;
  readonly status: string;
  readonly reason: string | null;
}

interface MigrationReviewRow {
  readonly ownerType: string;
  readonly ownerId: string;
  readonly status: string;
  readonly reason: string | null;
}

/**
 * The reason a reject is recorded with. The server stores a reject as
 * `needs_manual_review`, the same status the backfill gives an open flag, so
 * the reason is what tells "the athlete already answered" apart from "still
 * waiting for an answer".
 */
const ATHLETE_REJECTED_REASON = "athlete_rejected";

/**
 * Whether a review row still asks the athlete something. The list endpoint
 * also returns auto-resolved and already-answered rows, which used to render
 * as "Migration review: resolved" with the same three buttons on every open.
 * U25 (CODEBASE_ANALYSIS_2026-10-03)
 */
function isOpenReview(row: MigrationReviewRow, workoutLogId: string): boolean {
  return (
    row.ownerType === "workoutLog" &&
    row.ownerId === workoutLogId &&
    row.status === "needs_manual_review" &&
    row.reason !== ATHLETE_REJECTED_REASON
  );
}

async function fetchOpenReview(workoutLogId: string): Promise<MigrationReviewFlag | null> {
  const res = await fetch(
    `/api/v1/workouts/migration/reviews?ownerType=workoutLog&ownerId=${encodeURIComponent(workoutLogId)}`,
    { credentials: "include" },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as MigrationReviewRow[];
  const match = rows.find((row) => isOpenReview(row, workoutLogId));
  return match ? { ownerId: match.ownerId, status: match.status, reason: match.reason } : null;
}

export function useMigrationReview(workoutLogId: string | null) {
  const [flag, setFlag] = useState<MigrationReviewFlag | null>(null);

  useEffect(() => {
    if (!workoutLogId) return undefined;
    let cancelled = false;
    fetchOpenReview(workoutLogId)
      .then((next) => {
        if (!cancelled) setFlag(next);
      })
      .catch(ignoreAsyncError);
    return () => {
      cancelled = true;
    };
  }, [workoutLogId]);

  // An answered flag is done: the callout goes away instead of restating its
  // new status with the same buttons. A failure throws to the callout.
  const resolveReview = useCallback(
    async (action: MigrationReviewAction) => {
      if (!workoutLogId) return;
      await apiRequest("POST", "/api/v1/workouts/migration/reviews/resolve", {
        ownerType: "workoutLog",
        ownerId: workoutLogId,
        action,
        ...(action === "reject" ? { reason: ATHLETE_REJECTED_REASON } : {}),
      });
      setFlag((prev) => (prev?.ownerId === workoutLogId ? null : prev));
    },
    [workoutLogId],
  );

  // Only the open workout's flag: the previous workout's flag must not show
  // while this one's request is still in flight.
  const reviewFlag = flag?.ownerId === workoutLogId ? flag : null;
  return { reviewFlag, resolveReview };
}

/** Plain-language copy for the backfill's reason codes. */
function describeReviewReason(reason: string | null): string {
  switch (reason) {
    case "low_confidence_conversion":
      return "We turned this workout's text into the exercises above, but weren't confident about it. Check they match what you did.";
    case "parse_returned_no_rows":
      return "We couldn't find any exercises in this workout's text. Add them above if you want them tracked.";
    case "parse_error":
      return "Something went wrong turning this workout's text into exercises. Check the exercises above.";
    default:
      return "Check that the exercises above match what you did.";
  }
}

interface MigrationReviewCalloutProps {
  readonly reviewFlag: MigrationReviewFlag | null;
  readonly onResolveReview: (action: MigrationReviewAction) => Promise<void>;
}

const RESOLVE_BUTTONS: ReadonlyArray<{
  readonly action: MigrationReviewAction;
  readonly label: string;
  readonly variant: "outline" | "ghost";
}> = [
  { action: "accept", label: "Looks right", variant: "outline" },
  { action: "edit", label: "I've fixed them", variant: "outline" },
  { action: "reject", label: "Still wrong", variant: "ghost" },
];

export function MigrationReviewCallout({ reviewFlag, onResolveReview }: MigrationReviewCalloutProps) {
  const [resolvingAction, setResolvingAction] = useState<MigrationReviewAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!reviewFlag) return null;

  const handleResolve = (action: MigrationReviewAction) => {
    setResolvingAction(action);
    setError(null);
    onResolveReview(action)
      .catch((err: unknown) => {
        setError(humanizeApiError(err));
      })
      .finally(() => {
        setResolvingAction(null);
      });
  };

  return (
    <div
      className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground"
      data-testid="migration-review-callout"
    >
      <p className="font-medium">Check the converted exercises</p>
      <p className="text-muted-foreground">{describeReviewReason(reviewFlag.reason)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {RESOLVE_BUTTONS.map(({ action, label, variant }) => (
          <Button
            key={action}
            size="sm"
            variant={variant}
            onClick={() => {
              handleResolve(action);
            }}
            disabled={resolvingAction !== null}
            data-testid={`migration-review-${action}`}
          >
            {resolvingAction === action && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            {label}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs font-medium text-foreground" role="alert">
          Couldn&apos;t save your answer: {error}
        </p>
      ) : null}
    </div>
  );
}

function ignoreAsyncError(): undefined {
  return undefined;
}
