import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAuth } from "@/hooks/useAuth";
import { readAnalyticsSnapshot, useWriteAnalyticsSnapshot } from "@/lib/analyticsSnapshot";
import { api, QUERY_KEYS } from "@/lib/api";
import type { CoachInsightsResponse } from "@/lib/api/coaching";
import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

import { LastUpdatedNote } from "./LastUpdatedNote";

// Per-user localStorage snapshot key so a fresh page load paints the previous
// insights instantly instead of the empty "Generate" state, and so a different
// signed-in account never sees the prior user's cached insights.
const SNAPSHOT_PREFIX = "fitai-coach-insights-cache";

function describeError(error: unknown): string {
  if (error instanceof AiBudgetExceededError) {
    return "You've reached your daily AI usage limit. Please try again later.";
  }
  if (error instanceof RateLimitError) {
    if (error.retryAfter && error.retryAfter > 0) {
      return `You're requesting insights too quickly. Please wait about ${error.retryAfter} seconds and try again.`;
    }
    return "You're requesting insights too quickly. Please wait a moment and try again.";
  }
  if (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error &&
      (error.message.toLowerCase().includes("timed out") ||
        error.message.toLowerCase().includes("aborted")))
  ) {
    return "Generating insights is taking longer than expected. Please try again in a moment.";
  }
  if (
    error instanceof Error &&
    (error.message.includes("network") || error.message.includes("fetch"))
  ) {
    return "Network error — please check your connection and try again.";
  }
  return "Sorry, I couldn't generate your coach insights right now. Please try again.";
}

export function CoachInsightsTab() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Scoped by userId so signing into a different account in the same tab
  // doesn't render the previous user's insights from cache (the auth flow
  // resets CSRF but does not flush the QueryClient).
  const queryKey = [...QUERY_KEYS.coachInsights, userId ?? "anon"];
  const snapshotKey = userId ? `${SNAPSHOT_PREFIX}:${userId}` : null;
  const placeholder = useMemo(
    () => (snapshotKey ? readAnalyticsSnapshot<CoachInsightsResponse>(snapshotKey) : undefined),
    [snapshotKey],
  );

  // Loads the LAST stored insights (no AI spend) so the tab paints on open.
  const query = useQuery<CoachInsightsResponse>({
    queryKey,
    queryFn: () => api.chat.getStoredCoachInsights(),
    enabled: !!userId,
    // The stored result is authoritative — refreshed by the midnight cron or an
    // explicit Regenerate, not by remounts — so treat it as fresh and let tab
    // switches reuse it without refetching.
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: placeholder,
    retry: false,
  });
  useWriteAnalyticsSnapshot(snapshotKey, query.data, query.isPlaceholderData);

  // Explicit (re)generation — spends AI, persists server-side, and updates the
  // cache (which in turn refreshes the snapshot via the effect above).
  const regenerate = useMutation({
    mutationFn: () => api.chat.regenerateCoachInsights(),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  const data = query.data;
  const hasInsights = data?.insights != null;
  const isGenerating = regenerate.isPending;
  // Spinner only when there is genuinely nothing to show yet (no snapshot, no
  // stored result) and we're loading or generating the first one.
  const showInitialSpinner = (query.isLoading || isGenerating) && !hasInsights;
  const activeError = regenerate.error ?? query.error;
  const errorMessage = activeError ? describeError(activeError) : null;

  const handleGenerateInsights = () => {
    regenerate.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle as="h2">Coach Insights</CardTitle>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Button
              variant={hasInsights ? "outline" : "default"}
              onClick={handleGenerateInsights}
              disabled={isGenerating || !userId}
              data-testid="button-generate-coach-insights"
            >
              {(() => {
                if (isGenerating) {
                  return (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing…
                    </>
                  );
                }
                if (hasInsights) {
                  return (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Regenerate
                    </>
                  );
                }
                return (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate insights
                  </>
                );
              })()}
            </Button>
            <LastUpdatedNote value={data?.generatedAt} stale={data?.stale} className="text-right" />
          </div>
        </div>
        <CardDescription>
          AI-generated analysis of your training so far and how you&rsquo;re tracking against your
          goal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(() => {
          if (showInitialSpinner) {
            return (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center text-muted-foreground">
                <LoadingSpinner iconClassName="h-6 w-6" />
                <p className="text-sm">Reviewing your workouts, plan progress, and goal&hellip;</p>
              </div>
            );
          }

          if (errorMessage && !hasInsights) {
            return (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
                role="alert"
                data-testid="text-coach-insights-error"
              >
                {errorMessage}
              </div>
            );
          }

          if (!hasInsights) {
            return (
              <div className="text-center py-8 space-y-3 bg-muted/20 rounded-lg border border-dashed">
                <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <div className="space-y-1 px-4">
                  <p className="text-sm text-muted-foreground">
                    Generate a personalized analysis of your progress toward your goal, what&rsquo;s
                    working, and what to focus on next.
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {errorMessage && (
                <div
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                  role="alert"
                >
                  {errorMessage}
                </div>
              )}
              <div
                className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-headings:my-3"
                data-testid="text-coach-insights-content"
              >
                {/* AI output is rendered as markdown; rehype-sanitize strips
                    script tags, event handlers, and javascript:/data: URLs so a
                    compromised provider or prompt-injection attempt can't run
                    arbitrary JS in the user's session (C2). */}
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {data?.insights ?? ""}
                </ReactMarkdown>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
