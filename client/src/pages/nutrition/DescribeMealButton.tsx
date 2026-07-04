import type { ParseMealResponse } from "@shared/schema";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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

/**
 * "Describe a meal" entry point (FR-4.1): the user types a meal in plain English,
 * the AI parses it into food items, and the result is handed to the review sheet
 * (via `onParsed`) — nothing is logged until the user confirms there.
 */
export function DescribeMealButton({
  onParsed,
}: {
  readonly onParsed: (result: ParseMealResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parse = useParseMealText();

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    parse.mutate(trimmed, {
      onSuccess: (result) => {
        onParsed(result);
        setOpen(false);
        setText("");
      },
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-describe-meal"
      >
        <Sparkles className="mr-2 h-4 w-4" /> Describe a meal
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !parse.isPending) setOpen(false);
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
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 2 scrambled eggs, a slice of toast with butter, and a black coffee"
            rows={4}
            maxLength={2000}
            aria-label="Describe your meal"
            data-testid="input-describe-meal"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={parse.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={parse.isPending || text.trim().length === 0}
              data-testid="button-parse-meal"
            >
              {parse.isPending ? "Reading…" : "Review foods"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
