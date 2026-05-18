import { Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

const SAVE_DEBOUNCE_MS = 500;
type AthleteNoteMode = "review" | "form";

interface AthleteNoteInputProps {
  readonly value: string | null | undefined;
  readonly onSave: (note: string | null) => void;
  readonly disabled?: boolean;
  readonly reviewFirst?: boolean;
  readonly mode?: AthleteNoteMode;
}

type AthleteNoteInputViewProps = Omit<AthleteNoteInputProps, "onSave"> & {
  readonly persistDraft: (next: string) => void;
};

function toSavedAthleteNote(next: string): string | null {
  return next.trim().length === 0 ? null : next;
}

/**
 * Full-width athlete note at the bottom of the dialog. Keystrokes update
 * local state immediately, while the wrapper chooses whether persistence is
 * immediate or debounced. Parent controls the mutation; this component is
 * purely a controlled textarea with save timing injected.
 */
function AthleteNoteInputView({
  value,
  disabled,
  reviewFirst = false,
  mode = "review",
  persistDraft,
}: AthleteNoteInputViewProps) {
  const [draft, setDraft] = useState(value ?? "");
  const [isEditing, setIsEditing] = useState(!reviewFirst);

  // Re-sync when the workout prop changes (e.g. the dialog opens on a
  // different workout). A plain useEffect on `value` is enough — we don't
  // need to track the previous workout id.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value ?? "");
  }, [value]);

  if (mode === "form") {
    return (
      <section className="flex flex-col gap-2" data-testid="athlete-note-input" data-mode="form">
        <label
          htmlFor="athlete-note-textarea"
          className="text-sm font-semibold text-foreground"
        >
          Notes
        </label>
        <Textarea
          id="athlete-note-textarea"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            persistDraft(e.target.value);
          }}
          disabled={disabled}
          placeholder="How did it feel? Anything the coach should know?"
          rows={3}
          className="min-h-[96px] resize-none text-sm leading-relaxed"
        />
      </section>
    );
  }

  if (!isEditing) {
    const preview = draft.trim().length > 0 ? draft : "No athlete note yet.";
    return (
      <section className="flex flex-col gap-2" data-testid="athlete-note-input">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Athlete note
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            data-testid="athlete-note-edit"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </Button>
        </div>
        <button
          type="button"
          className="min-h-[52px] rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsEditing(true)}
          disabled={disabled}
          data-testid="athlete-note-review"
        >
          {preview}
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" data-testid="athlete-note-input">
      <label
        htmlFor="athlete-note-textarea"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        Athlete note
      </label>
      <Textarea
        id="athlete-note-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          persistDraft(e.target.value);
        }}
        onBlur={() => {
          if (reviewFirst) setIsEditing(false);
        }}
        disabled={disabled}
        placeholder="Tap to add a note..."
        rows={2}
        className="resize-none"
      />
    </section>
  );
}

export function AthleteNoteInput({ onSave, ...props }: AthleteNoteInputProps) {
  const debouncedSave = useDebouncedCallback((next: string) => {
    onSave(toSavedAthleteNote(next));
  }, SAVE_DEBOUNCE_MS);

  return <AthleteNoteInputView {...props} persistDraft={debouncedSave} />;
}

export function ImmediateAthleteNoteInput({ onSave, ...props }: AthleteNoteInputProps) {
  const saveImmediately = useCallback(
    (next: string) => {
      onSave(toSavedAthleteNote(next));
    },
    [onSave],
  );

  return <AthleteNoteInputView {...props} persistDraft={saveImmediately} />;
}
