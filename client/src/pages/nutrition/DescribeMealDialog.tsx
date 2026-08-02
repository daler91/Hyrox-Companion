import type { ParseMealResponse } from "@shared/schema";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useParseMealText } from "@/hooks/useNutrition";

import { useAiConsentGate } from "./useAiConsentGate";

/**
 * "Describe a meal" dialog (FR-4.1): the user types a meal in plain English,
 * the AI parses it into food items, and the result is handed to the review
 * sheet (via `onParsed`) — nothing is logged until the user confirms there.
 *
 * Controlled by the caller so any surface (the log-food method sheet, the
 * first-run starter) can open it. Parsing is consent-gated inline: a user who
 * hasn't enabled AI features gets the consent dialog here, and accepting
 * resumes the parse with their text intact.
 */
export function DescribeMealDialog({
  open,
  onOpenChange,
  onParsed,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onParsed: (result: ParseMealResponse) => void;
}) {
  const [text, setText] = useState("");
  const [noFoodsFound, setNoFoodsFound] = useState(false);
  const parse = useParseMealText();
  const { requireAiConsent, aiConsentDialog, aiConsentOpen } = useAiConsentGate();

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setNoFoodsFound(false);
    requireAiConsent(() =>
      parse.mutate(trimmed, {
        onSuccess: (result) => {
          // An empty parse is a retry, not a result: keep the dialog and the
          // typed text so the athlete can add detail instead of starting over.
          if (result.items.length === 0) {
            setNoFoodsFound(true);
            return;
          }
          onParsed(result);
          onOpenChange(false);
          setText("");
        },
      }),
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !parse.isPending && !aiConsentOpen) onOpenChange(false);
        }}
      >
        <DialogContent data-testid="dialog-describe-meal">
          <DialogHeader>
            <DialogTitle>Describe a meal</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Type what you ate in plain English — we&apos;ll identify the foods and estimate portions
            for you to review before logging.
          </DialogDescription>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setNoFoodsFound(false);
            }}
            placeholder="e.g. 2 scrambled eggs, a slice of toast with butter, and a black coffee"
            rows={4}
            maxLength={2000}
            aria-label="Describe your meal"
            aria-describedby="describe-meal-count"
            data-testid="input-describe-meal"
          />
          <CharacterCount id="describe-meal-count" value={text} max={2000} />
          {noFoodsFound && (
            <p className="text-sm text-amber-600" role="status" data-testid="text-no-foods-found">
              No foods detected — add a little more detail (amounts and cooking style help) and try
              again.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={parse.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={parse.isPending || text.trim().length === 0}
              aria-busy={parse.isPending}
              data-testid="button-parse-meal"
            >
              {parse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {parse.isPending ? "Reading…" : "Review foods"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {aiConsentDialog}
    </>
  );
}
