import type { WeeklyReview } from "@shared/schema";
// Value import, so it must come from a leaf module rather than the schema
// barrel — the barrel would pull drizzle into the client bundle.
import { WEEKLY_REVIEW_INTENT_MAX_LENGTH } from "@shared/weeklyReview";
import { Quote } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CharacterCount } from "@/components/ui/character-count";
import { Textarea } from "@/components/ui/textarea";
import { useSetWeeklyReviewIntent } from "@/hooks/useWeeklyReview";

/**
 * The one line the athlete carries into next week, and the one they wrote last
 * week shown back to them.
 *
 * Nothing scores the week against the previous intent. The value is the recall
 * — being reminded on Monday of what you told yourself on Sunday — and grading
 * someone against their own aspiration is how a ritual becomes a chore.
 */
export function WeeklyReviewIntent({ review }: { readonly review: WeeklyReview }) {
  const { weekStart, intent, previousIntent } = review;
  // Paging to another week must not carry the draft across. The caller keys
  // this component on the week so it remounts and re-seeds from the new
  // intent, the same way SkipConfirmDialog resets its draft reason — a
  // remount rather than a setState-in-effect.
  const [draft, setDraft] = useState(intent ?? "");
  const mutation = useSetWeeklyReviewIntent(weekStart);

  const trimmed = draft.trim();
  const saved = intent ?? "";
  const isDirty = trimmed !== saved;

  return (
    <Card data-testid="weekly-review-intent">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Next week</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {previousIntent && (
          <div className="flex gap-2 rounded-md bg-muted/50 p-3" data-testid="weekly-review-previous-intent">
            <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Last week you said
              </p>
              <p className="mt-0.5 text-sm">{previousIntent}</p>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="weekly-review-intent-input" className="text-sm text-muted-foreground">
            One thing to carry into next week
          </label>
          <Textarea
            id="weekly-review-intent-input"
            data-testid="weekly-review-intent-input"
            className="mt-1.5"
            rows={2}
            value={draft}
            maxLength={WEEKLY_REVIEW_INTENT_MAX_LENGTH}
            aria-describedby="weekly-review-intent-count"
            placeholder="e.g. get three runs in, and actually take the rest day"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <CharacterCount
              id="weekly-review-intent-count"
              value={draft}
              max={WEEKLY_REVIEW_INTENT_MAX_LENGTH}
            />
            <Button
              size="sm"
              // Clearing a saved intent is a real edit, so the button stays live
              // for an emptied box; it is only inert when nothing has changed.
              disabled={!isDirty || mutation.isPending}
              data-testid="weekly-review-intent-save"
              onClick={() => mutation.mutate(trimmed === "" ? null : trimmed)}
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
