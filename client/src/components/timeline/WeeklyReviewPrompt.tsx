import { CalendarCheck, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { dismissPrompt, getWeeklyReviewPrompt, isPromptDismissed } from "@/lib/weeklyReviewPrompt";

/**
 * The Sunday-evening-through-Tuesday nudge into the weekly review.
 *
 * Renders nothing outside that window, nothing once dismissed for the week,
 * and nothing for a signed-out render — a prompt with no user has nowhere to
 * record the dismissal, so it would return on every load.
 */
export function WeeklyReviewPrompt() {
  const { user } = useAuth();
  const prompt = getWeeklyReviewPrompt();
  const userId = user?.id;

  // Lazy initializer so storage is read once on mount rather than through a
  // cascading setState, matching PrivacyConsentBanner.
  const [dismissed, setDismissed] = useState<boolean>(() =>
    userId && prompt ? isPromptDismissed(userId, prompt.weekStart) : false,
  );

  if (!prompt || !userId || dismissed) return null;

  return (
    <Card className="mb-4 border-primary/30 bg-primary/5" data-testid="weekly-review-prompt">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">
              {prompt.isWrappingUp
                ? "Your training week is wrapping up"
                : "Last week is ready to review"}
            </p>
            <p className="text-sm text-muted-foreground">
              {prompt.isWrappingUp
                ? "See how it went and what changed against the week before."
                : "What you planned, what you did, and what changed."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" data-testid="weekly-review-prompt-open">
            <Link href={`/review?week=${prompt.weekStart}`}>Open review</Link>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss weekly review prompt"
                  data-testid="weekly-review-prompt-dismiss"
                  onClick={() => {
                    dismissPrompt(userId, prompt.weekStart);
                    setDismissed(true);
                  }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dismiss prompt</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
