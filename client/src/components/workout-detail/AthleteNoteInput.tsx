import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

const SAVE_DEBOUNCE_MS = 500;

interface AthleteNoteInputProps {
  readonly value: string | null | undefined;
  readonly onSave: (note: string | null) => void;
  readonly disabled?: boolean;
  readonly reviewFirst?: boolean;
}

/**
 * Full-width athlete note at the bottom of the dialog. Keystrokes update
 * local state immediately; the persisted save is debounced 500ms so every
 * character doesn't hit the API. Parent controls the mutation — this
 * component is purely a controlled textarea with built-in debounce.
 */
export function AthleteNoteInput({ value, onSave, disabled, reviewFirst = false }: AthleteNoteInputProps) {
  const [draft, setDraft] = useState(value ?? "");
  const [isEditing, setIsEditing] = useState(!reviewFirst);

  // Re-sync when the workout prop changes (e.g. the dialog opens on a
  // different workout). A plain useEffect on `value` is enough — we don't
  // need to track the previous workout id.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value ?? "");
  }, [value]);

  const debouncedSave = useDebouncedCallback((next: string) => {
    onSave(next.trim().length === 0 ? null : next);
  }, SAVE_DEBOUNCE_MS);

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
      <label htmlFor="athlete-note-textarea" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Athlete note
      </label>
      <Textarea
        id="athlete-note-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          debouncedSave(e.target.value);
        }}
        onBlur={() => {
          if (reviewFirst) setIsEditing(false);
        }}
        disabled={disabled}
        placeholder="Tap to add a note…"
        rows={2}
        className="resize-none"
      />
    </section>
  );
}
