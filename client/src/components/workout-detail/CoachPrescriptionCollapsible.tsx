import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageCaptureButton } from "@/components/ImageCaptureButton";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ExerciseImagePreview } from "@/components/workout/ExerciseImagePreview";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import type { CompressedImage } from "@/lib/image";
import { cn } from "@/lib/utils";

export type PrescriptionField = "mainWorkout" | "accessory" | "notes";

interface CoachPrescriptionCollapsibleProps {
  readonly mainWorkout: string | null | undefined;
  readonly accessory: string | null | undefined;
  readonly notes: string | null | undefined;
  /**
   * Header label. Defaults to "Coach's prescription" for planned/prescribed
   * entries. Logged workouts pass "Workout description" since the free text
   * there is the athlete's own description, not a coach's note.
   */
  readonly title?: string;
  /**
   * Open on mount when `true` (uncontrolled). Ignored when `open` is passed.
   */
  readonly defaultOpen?: boolean;
  /**
   * Controlled open state. When provided, the parent owns collapse/expand
   * (e.g. to auto-collapse after a successful parse).
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * Optional editor callbacks. Omit to keep the panel read-only (e.g.
   * workouts owned by another user, historical rows). When supplied the
   * fields render as auto-saving textareas.
   */
  readonly onSaveField?: (field: PrescriptionField, value: string) => void;
  /**
   * Parse the current free text into structured exercise rows. When set,
   * the panel shows a "Parse" button on the header row so it's reachable
   * even when the panel is collapsed. The parent is responsible for
   * confirming with the user if existing sets would be replaced — this
   * component just fires the callback.
   */
  readonly onParse?: () => void;
  readonly isParsing?: boolean;
  /**
   * Image capture + preview. Enabling these props swaps the collapsible's
   * body for a preview surface (thumbnail + Retake / Parse) while a
   * capture is pending. Leaving them undefined hides the photo button and
   * keeps the text-only flow.
   */
  readonly onCapture?: (image: CompressedImage) => void;
  readonly imagePreview?: { readonly url: string; readonly error?: string | null } | null;
  readonly onRetakeImage?: () => void;
  readonly onParseImage?: () => void;
  readonly isParsingImage?: boolean;
}

/**
 * Editable view of the free-text prescription. In the new exercise-first
 * model this section is secondary — the structured exercise table is the
 * primary prescription. The athlete can still type or paste free text
 * here, then tap "Parse to exercises" to convert it into structured rows
 * via Gemini. Save is auto-debounced on blur.
 *
 * Returns null when there's no content AND no editor (read-only view on
 * an empty prescription). When editors are supplied, the panel always
 * renders so the athlete has somewhere to type.
 */
export function CoachPrescriptionCollapsible({
  mainWorkout,
  accessory,
  notes,
  title = "Coach's prescription",
  defaultOpen = false,
  open,
  onOpenChange,
  onSaveField,
  onParse,
  isParsing,
  onCapture,
  imagePreview,
  onRetakeImage,
  onParseImage,
  isParsingImage,
}: CoachPrescriptionCollapsibleProps) {
  const hasContent = hasText(mainWorkout) || hasText(accessory) || hasText(notes);
  const editable = typeof onSaveField === "function";
  const previewActive = !!imagePreview && !!onRetakeImage && !!onParseImage;
  if (!hasContent && !editable && !previewActive) return null;

  const collapsibleProps = open === undefined
    ? { defaultOpen }
    : { open, onOpenChange };

  return (
    <Collapsible
      {...collapsibleProps}
      className="rounded-lg border border-border"
      data-testid="coach-prescription-collapsible"
    >
      <div className="group flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <CollapsibleTrigger
          className="flex flex-1 items-center justify-between gap-2 hover:text-foreground"
          data-testid="coach-prescription-toggle"
        >
          <span>{title}</span>
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              "group-data-[state=open]:rotate-180",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        {/*
          Header actions hide while a capture is being confirmed — the
          preview body owns Retake + Parse in that state. Keeping them
          visible would duplicate the Parse action and let the user fire
          a text-parse on the still-populated textareas mid-confirm.
        */}
        {!previewActive && onCapture && (
          <ImageCaptureButton
            onImage={onCapture}
            size="sm"
            className="h-7 shrink-0"
            disabled={isParsing}
            data-testid="coach-prescription-photo"
            label="Scan"
          />
        )}
        {!previewActive && onParse && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-2 h-7 shrink-0"
            onClick={onParse}
            disabled={isParsing || !hasContent}
            data-testid="coach-prescription-parse"
          >
            {isParsing ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-1.5 size-3.5" aria-hidden />
            )}
            {isParsing ? "Parsing…" : "Parse"}
          </Button>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm">
        {previewActive ? (
          <ExerciseImagePreview
            previewUrl={imagePreview.url}
            error={imagePreview.error ?? null}
            isParsing={isParsingImage}
            onRetake={onRetakeImage}
            onParse={onParseImage}
          />
        ) : (
          <>
            <PrescriptionSection
              field="mainWorkout"
              label="Main"
              text={mainWorkout ?? ""}
              editable={editable}
              onSaveField={onSaveField}
            />
            <PrescriptionSection
              field="accessory"
              label="Accessory"
              text={accessory ?? ""}
              editable={editable}
              onSaveField={onSaveField}
            />
            <PrescriptionSection
              field="notes"
              label="Notes"
              text={notes ?? ""}
              editable={editable}
              onSaveField={onSaveField}
            />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface PrescriptionSectionProps {
  readonly field: PrescriptionField;
  readonly label: string;
  readonly text: string;
  readonly editable: boolean;
  readonly onSaveField?: (field: PrescriptionField, value: string) => void;
}

function PrescriptionSection({ field, label, text, editable, onSaveField }: Readonly<PrescriptionSectionProps>) {
  if (!editable) {
    if (!hasText(text)) return null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <p className="whitespace-pre-wrap text-foreground">{text}</p>
      </div>
    );
  }
  return (
    <EditablePrescription
      field={field}
      label={label}
      value={text}
      onSave={onSaveField!}
    />
  );
}

const PRESCRIPTION_SAVE_DEBOUNCE_MS = 600;

interface EditablePrescriptionProps {
  readonly field: PrescriptionField;
  readonly label: string;
  readonly value: string;
  readonly onSave: (field: PrescriptionField, value: string) => void;
}

function EditablePrescription({ field, label, value, onSave }: Readonly<EditablePrescriptionProps>) {
  // Local draft so keystrokes feel instant; debounced onSave fans out the
  // PATCH to the server. Sync from props when the upstream value changes
  // (optimistic cache updates, initial fetch) without fighting an active
  // edit: if the draft matches the last-seen prop we accept the new prop,
  // otherwise the user's in-progress edit wins.
  const [draft, setDraft] = useState(value);
  const [lastExternal, setLastExternal] = useState(value);
  if (value !== lastExternal) {
    setLastExternal(value);
    if (draft === lastExternal) setDraft(value);
  }

  const debouncedSave = useDebouncedCallback((next: string) => onSave(field, next), PRESCRIPTION_SAVE_DEBOUNCE_MS);

  // Flush any pending edit on unmount so a fast dialog close doesn't drop
  // the last keystroke before the debounce timer fires.
  useEffect(() => {
    return () => {
      if (draft !== lastExternal) onSave(field, draft);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeholder = placeholderFor(field);

  return (
    <label className="flex flex-col gap-1" htmlFor={`prescription-${field}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <textarea
        id={`prescription-${field}`}
        className="min-h-[72px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors hover:border-ring/60 focus:border-ring focus-visible:ring-2 focus-visible:ring-ring"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          debouncedSave(e.target.value);
        }}
        onBlur={() => {
          // The dialog's Save handler calls `active.blur()` to drive a
          // synchronous flush before regenerating the coach note. Without
          // this onBlur save the 600ms debounce keeps pending text off
          // the server and regenerate runs against a stale plan day.
          // `lastExternal` only tracks the prop — writing `draft` into it
          // here used to trip the during-render sync into reverting the
          // textarea to the stale prop value the moment focus left the
          // field.
          if (draft !== lastExternal) {
            onSave(field, draft);
          }
        }}
        data-testid={`prescription-textarea-${field}`}
      />
    </label>
  );
}

function placeholderFor(field: PrescriptionField): string {
  switch (field) {
    case "mainWorkout":
      return "Describe the main workout — e.g. 5×500m row @ 2:00/500, 2 min rest.";
    case "accessory":
      return "Accessory work (optional).";
    case "notes":
      return "Notes the coach left you (optional).";
  }
}

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}
