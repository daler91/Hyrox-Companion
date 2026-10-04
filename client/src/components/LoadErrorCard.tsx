import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface LoadErrorCardProps {
  /** What could not be loaded, e.g. "Couldn't load your timeline". */
  readonly title: string;
  readonly onRetry: () => void;
  /**
   * A retry is in flight (or waiting for the network). Not `isRefetching`:
   * a retry of a query with no data resets it to pending, so that is false
   * whenever this card shows. `useTimelineData` derives it from the failure
   * count and `fetchStatus` instead. U5 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly isRetrying?: boolean;
  /** `${testId}` on the card, `${testId}-retry` on its button. */
  readonly testId: string;
}

/**
 * What a page shows when its data request failed, in place of the empty or
 * first-run state it would otherwise fall through to. A failed fetch read as
 * "nothing logged yet": a returning athlete got the welcome card, a 0 kcal day
 * or "No workout data yet", and acting on it could create a duplicate plan or
 * re-log meals already recorded. U5 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function LoadErrorCard({
  title,
  onRetry,
  isRetrying = false,
  testId,
}: Readonly<LoadErrorCardProps>) {
  return (
    <Card role="alert" data-testid={testId}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We couldn&apos;t reach the server. Nothing you&apos;ve logged is lost.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onRetry}
          disabled={isRetrying}
          data-testid={`${testId}-retry`}
        >
          {isRetrying ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isRetrying ? "Retrying…" : "Try again"}
        </Button>
      </CardContent>
    </Card>
  );
}
