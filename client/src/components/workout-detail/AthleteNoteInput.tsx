import { useEffect, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

const SAVE_DEBOUNCE_MS = 500;

interface AthleteNoteInputProps {
  readonly value: string | null | undefined;
  readonly onSave: (note: string | null) => void;
  readonly disabled?: boolean;
}

/**
 * Full-width athlete note at the bottom of the dialog. Keystrokes update
 * local state immediately; the persisted save is debounced 500ms so every
 * character doesn't hit the API. Parent controls the mutation — this
 * component is purely a controlled textarea with built-in debounce.
 */
export function AthleteNoteInput({ value, onSave, disabled }: AthleteNoteInputProps) {
  const [draft, setDraft] = useState(value ?? "");

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
        disabled={disabled}
        placeholder="Tap to add a note…"
        rows={2}
        className="resize-none"
      />
    </section>
  );
}
