import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDiscardAthleteNote, useImportAthleteNote } from "@/hooks/useAthleteFacts";

interface LegacyNoteBannerProps {
  /** The older free-text injuries note, trimmed and non-empty. */
  readonly note: string;
}

/**
 * The older free-text injuries note, from before the athlete card. The coach
 * reads it until the athlete moves it onto the card (a fact per sentence) or
 * removes it; nothing moves it for them.
 */
export function LegacyNoteBanner({ note }: LegacyNoteBannerProps) {
  const importNote = useImportAthleteNote();
  const discard = useDiscardAthleteNote();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const busy = importNote.isPending || discard.isPending;

  return (
    <section
      aria-labelledby="legacy-note-heading"
      className="space-y-2 rounded-md border border-dashed p-3"
      data-testid="legacy-injuries-note"
    >
      <h3 id="legacy-note-heading" className="text-sm font-medium">
        Your older injuries note
      </h3>
      <p className="whitespace-pre-wrap break-words text-sm">{note}</p>
      <p className="text-xs text-muted-foreground">
        Your coach still reads this note. Add it to your card to keep each part up to date on its
        own, or remove it if it no longer applies.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            importNote.mutate();
          }}
          disabled={busy}
        >
          Add to card
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setConfirmingRemove(true);
          }}
          disabled={busy}
        >
          Remove note
        </Button>
      </div>
      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your older note?</AlertDialogTitle>
            <AlertDialogDescription>
              Your coach stops reading it, and nothing from it is added to your card.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                discard.mutate();
              }}
            >
              Remove note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
