import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

import { LastUpdatedNote } from "@/components/analytics/LastUpdatedNote";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useNutritionInsights, useRegenerateNutritionInsights } from "@/hooks/useNutrition";

/**
 * AI nutrition coaching (FR-5.3). Mirrors Coach Insights: GET paints the last
 * stored analysis instantly (no AI spend) with a staleness note; the button
 * regenerates (AI-gated server-side) and refreshes the cached result.
 */
export function NutritionInsightsPanel() {
  const query = useNutritionInsights();
  const regenerate = useRegenerateNutritionInsights();

  const data = query.data;
  const hasInsights = data?.insights != null;
  const isGenerating = regenerate.isPending;
  const showInitialSpinner = (query.isLoading || isGenerating) && !hasInsights;

  const buttonLabel = () => {
    if (isGenerating) return (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing…</>);
    if (hasInsights) return (<><RefreshCw className="mr-2 h-4 w-4" />Regenerate</>);
    return (<><Sparkles className="mr-2 h-4 w-4" />Generate insights</>);
  };

  const body = () => {
    if (showInitialSpinner) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
          <LoadingSpinner iconClassName="h-6 w-6" />
          <p className="text-sm">Reviewing your recent intake, training load, and targets…</p>
        </div>
      );
    }
    if (hasInsights) {
      return (
        <div
          className="prose prose-sm max-w-none dark:prose-invert prose-headings:my-3 prose-p:my-2 prose-ul:my-2 prose-li:my-1"
          data-testid="nutrition-insights-content"
        >
          {/* AI output rendered as Markdown; rehype-sanitize strips scripts and
              unsafe URLs so a compromised provider can't run JS in the session. */}
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{data?.insights ?? ""}</ReactMarkdown>
        </div>
      );
    }
    return (
      <div
        className="space-y-3 rounded-lg border border-dashed bg-muted/20 py-8 text-center"
        data-testid="nutrition-insights-empty"
      >
        <Sparkles className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="px-4 text-sm text-muted-foreground">
          Generate a personalized analysis of your fuelling — how your intake tracks your training,
          where you&rsquo;re falling short, and what to focus on next.
        </p>
      </div>
    );
  };

  return (
    <Card data-testid="nutrition-insights-panel">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle as="h2">Nutrition Insights</CardTitle>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Button
              variant={hasInsights ? "outline" : "default"}
              size="sm"
              onClick={() => regenerate.mutate()}
              disabled={isGenerating}
              data-testid="button-generate-nutrition-insights"
            >
              {buttonLabel()}
            </Button>
            <LastUpdatedNote value={data?.generatedAt} stale={data?.stale} className="text-right" />
          </div>
        </div>
        <CardDescription>
          AI analysis of your recent fuelling against your training load and targets.
        </CardDescription>
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  );
}
