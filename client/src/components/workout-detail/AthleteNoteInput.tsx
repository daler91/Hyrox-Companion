import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 500;

interface AthleteNoteInputProps {
  readonly value: string | null | undefined;
  readonly onSave: (note: string | null) => void;
  readonly disabled?: boolean;
  readonly reviewFirst?: boolean;
  readonly emphasized?: boolean;
}

/**
 * Full-width athlete note at the bottom of the dialog. Keystrokes update
 * local state immediately; the persisted save is debounced 500ms so every
 * character doesn't hit the API. Parent controls the mutation — this
 * component is purely a controlled textarea with built-in debounce.
 */
export function AthleteNoteInput({
  value,
  onSave,
  disabled,
  reviewFirst = false,
  emphasized = false,
}: AthleteNoteInputProps) {
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
      <section
        className={cn("flex flex-col gap-2", emphasized && "gap-3")}
        data-testid="athlete-note-input"
        data-emphasis={emphasized ? "reflect" : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "text-xs font-medium uppercase tracking-wide text-muted-foreground",
            emphasized && "text-sm font-semibold text-foreground",
          )}>
            Athlete note
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 px-2 text-xs text-muted-foreground",
              emphasized && "h-8 border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/40",
            )}
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
          className={cn(
            "min-h-[52px] rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            emphasized && "min-h-[112px] bg-background px-4 py-3 text-base leading-relaxed text-foreground",
          )}
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
    <section
      className={cn("flex flex-col gap-2", emphasized && "gap-3")}
      data-testid="athlete-note-input"
      data-emphasis={emphasized ? "reflect" : undefined}
    >
      <label
        htmlFor="athlete-note-textarea"
        className={cn(
          "text-xs font-medium uppercase tracking-wide text-muted-foreground",
          emphasized && "text-sm font-semibold text-foreground",
        )}
      >
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
        placeholder={emphasized ? "Add an athlete note..." : "Tap to add a note..."}
        rows={emphasized ? 4 : 2}
        className={cn("resize-none", emphasized && "min-h-[120px] text-base leading-relaxed")}
      />
    </section>
  );
}
