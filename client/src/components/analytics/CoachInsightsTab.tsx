import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { CoachInsightsResponse } from "@/lib/api/coaching";
import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

// Stable query key so the cached result survives Radix TabsContent
// unmounting this component when the user switches analytics tabs.
// Scoped by userId so signing into a different account in the same tab
// doesn't render the previous user's insights from cache (the auth flow
// resets CSRF but does not flush the QueryClient).
const buildCoachInsightsQueryKey = (userId: string) =>
  ["/api/v1/coach-insights", userId] as const;

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
    (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError"))
    || (error instanceof Error && (error.message.toLowerCase().includes("timed out") || error.message.toLowerCase().includes("aborted")))
  ) {
    return "Generating insights is taking longer than expected. Please try again in a moment.";
  }
  if (error instanceof Error && (error.message.includes("network") || error.message.includes("fetch"))) {
    return "Network error — please check your connection and try again.";
  }
  return "Sorry, I couldn't generate your coach insights right now. Please try again.";
}

export function CoachInsightsTab() {
  const { user } = useAuth();
  const userId = user?.id;
  const query = useQuery<CoachInsightsResponse>({
    // queryFn is unreachable while userId is undefined because enabled
    // gates the request, but the key still has to be a string so the
    // cache slot is stable. Falling back to "anon" keeps the
    // pre-sign-in slot isolated from any signed-in user's slot.
    queryKey: buildCoachInsightsQueryKey(userId ?? "anon"),
    queryFn: () => api.chat.getCoachInsights(),
    // Manual generation only — never auto-fetch on mount.
    enabled: false,
    // Insights are an explicit user action, not a derived view of changing
    // server state. Treat the cached result as fresh until the user
    // explicitly regenerates so re-mounts (tab switches) don't refetch.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  const data = query.data;
  const isLoading = query.isFetching;
  const hasInsights = data !== undefined;
  const errorMessage = query.error ? describeError(query.error) : null;

  const generatedLabel = data?.generatedAt
    ? (() => {
        const parsed = new Date(data.generatedAt);
        return Number.isNaN(parsed.getTime()) ? null : format(parsed, "MMM d, yyyy 'at' h:mm a");
      })()
    : null;
  const handleGenerateInsights = () => {
    query.refetch().catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle as="h2">Coach Insights</CardTitle>
          </div>
          <Button
            variant={hasInsights ? "outline" : "default"}
            onClick={handleGenerateInsights}
            disabled={isLoading || !userId}
            data-testid="button-generate-coach-insights"
          >
            {(() => {
              if (isLoading) {
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
        </div>
        <CardDescription>
          AI-generated analysis of your training so far and how you&rsquo;re tracking against your goal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(() => {
          if (isLoading && !hasInsights) {
            return (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">Reviewing your workouts, plan progress, and goal&hellip;</p>
              </div>
            );
          }

          if (errorMessage && !hasInsights) {
            return (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
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
                    Generate a personalized analysis of your progress toward your goal, what&rsquo;s working,
                    and what to focus on next.
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              {errorMessage && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
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
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{data.insights}</ReactMarkdown>
              </div>
              {generatedLabel && (
                <p className="text-xs text-muted-foreground border-t pt-3">
                  Generated {generatedLabel}. Insights reflect your data at that moment.
                </p>
              )}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
