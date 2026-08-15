import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

import { WeeklyReviewHighlights } from "@/components/review/WeeklyReviewHighlights";
import { WeeklyReviewSessions } from "@/components/review/WeeklyReviewSessions";
import { WeeklyReviewSummary } from "@/components/review/WeeklyReviewSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageContainer } from "@/components/ui/PageContainer";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { useWeeklyReview } from "@/hooks/useWeeklyReview";
import { addDays, formatWeekRange, lastCompletedWeekStart, mondayOf } from "@/lib/weekDates";

function EmptyWeek({ isCurrentWeek }: { readonly isCurrentWeek: boolean }) {
  return (
    <Card data-testid="weekly-review-empty">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarRange className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          {/* No red, no 0%, no "you missed": a week with nothing in it is a
              starting point for a new athlete and old news for anyone else.
              A report card here is the fastest way to lose them. */}
          <p className="font-medium">
            {isCurrentWeek ? "Nothing logged yet this week" : "Nothing logged this week"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isCurrentWeek
              ? "Sessions you log will show up here, alongside how the week compares to the last one."
              : "Page back to a week you trained, or start logging — reviews build up from here."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Review() {
  useDocumentTitle("Weekly Review");
  // Any date inside the week is a valid param; the server anchors it to the
  // Monday, so a shared link never has to be normalised first.
  const [week, setWeek] = useUrlQueryState("week", lastCompletedWeekStart());
  const { data: review, isLoading, isError, refetch } = useWeeklyReview(week);

  // Page from the week the SERVER resolved, not the requested string: they can
  // differ by a day when the athlete's stored timezone is not the browser's,
  // and stepping from the requested value would then skip or repeat a week.
  const anchor = review?.weekStart ?? mondayOf(week);
  // The server's own verdict on "is this the running week", for the same
  // reason: it resolved the week in the athlete's timezone. The local
  // comparison is only the fallback before the first payload arrives.
  const isAtCurrentWeek = review?.isCurrentWeek ?? anchor >= lastCompletedWeekStart();

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Weekly Review</h1>
          <p className="text-sm text-muted-foreground" data-testid="weekly-review-range">
            {review ? formatWeekRange(review.weekStart, review.weekEnd) : " "}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {review?.isCurrentWeek && (
            <Badge variant="secondary" data-testid="weekly-review-in-progress">
              In progress
            </Badge>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            data-testid="weekly-review-prev"
            onClick={() => setWeek(addDays(anchor, -7))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            data-testid="weekly-review-next"
            // The current week is the last one worth opening — there is nothing
            // to review in a week that has not started.
            disabled={isAtCurrentWeek}
            onClick={() => setWeek(addDays(anchor, 7))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {isLoading && !review && <LoadingSpinner />}

      {isError && !review && (
        <Card data-testid="weekly-review-error">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">Couldn&apos;t load this week</p>
            <Button variant="outline" onClick={() => void refetch()} data-testid="weekly-review-retry">
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {review && (
        <div className="space-y-6" data-testid="weekly-review">
          <WeeklyReviewSummary review={review} />
          <WeeklyReviewHighlights review={review} />
          {review.sessions.length === 0 && review.plannedDays.length === 0 ? (
            <EmptyWeek isCurrentWeek={review.isCurrentWeek} />
          ) : (
            <WeeklyReviewSessions review={review} />
          )}
        </div>
      )}
    </PageContainer>
  );
}
