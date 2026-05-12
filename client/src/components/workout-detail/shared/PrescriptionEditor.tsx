import type { AllowedImageMimeType } from "@shared/schema";
import { useEffect, useRef, useState } from "react";

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
import { CoachPrescriptionCollapsible, type PrescriptionField } from "@/components/workout-detail/CoachPrescriptionCollapsible";
import type { CompressedImage } from "@/lib/image";

export interface PrescriptionEditorProps {
  /** Stable id of the owning entry; resets transient state when it changes. */
  readonly entryId: string;
  /** Whether the workout already has structured sets — gates the confirm
   *  dialog (parse replaces existing rows). */
  readonly hasSets: boolean;
  readonly mainWorkout: string | null | undefined;
  readonly accessory: string | null | undefined;
  readonly notes: string | null | undefined;
  /** Single-field debounced save from the textarea. */
  readonly onSaveField: (field: PrescriptionField, value: string) => void;
  /** Fire the text-parse mutation with the current visible text. */
  readonly onParseText: (payload: PrescriptionTextPayload) => void;
  /** Fire the image-parse mutation. */
  readonly onParseImage: (payload: { imageBase64: string; mimeType: AllowedImageMimeType }) => void;
  readonly isParsingText: boolean;
  readonly isParsingImage: boolean;
  readonly title?: string;
  readonly compact?: boolean;
  /**
   * Pass false when the parent surface owns notes editing through a
   * different mutation (e.g. ReviewSurface uses AthleteNoteInput for
   * `notes`). Forwarded to CoachPrescriptionCollapsible. Defaults to
   * true.
   */
  readonly showNotes?: boolean;
}

type PendingParseSource = "text" | "image" | null;

export interface PrescriptionTextPayload {
  readonly mainWorkout: string | null;
  readonly accessory: string | null;
}

interface ImagePreviewState {
  readonly url: string;
  readonly base64: string;
  readonly mimeType: AllowedImageMimeType;
}

function normalizeText(value: string | null | undefined): string {
  return value ?? "";
}

/**
 * Source-agnostic prescription editor reusable across the new sheet-native
 * surfaces. Wraps CoachPrescriptionCollapsible (the legacy textarea + parse
 * UI) and adds the "replace existing exercises?" confirm dialog locally so
 * neither LogSheet nor ReviewSurface has to plumb the dialog AlertDialog
 * machinery in.
 *
 * Mutations are passed in as plain callbacks — consumers adapt their
 * underlying hook (usePlanDayExercises for planned, useWorkoutDetail for
 * logged) to this shape, which keeps the editor decoupled from either
 * source.
 *
 * Image preview state lives here (with blob-URL revocation) so a fresh
 * capture survives across re-renders without leaking object URLs.
 */
export function PrescriptionEditor({
  entryId,
  hasSets,
  mainWorkout,
  accessory,
  notes,
  onSaveField,
  onParseText,
  onParseImage,
  isParsingText,
  isParsingImage,
  title,
  compact,
  showNotes = true,
}: PrescriptionEditorProps) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [confirmingParse, setConfirmingParse] = useState(false);
  const [pendingParseSource, setPendingParseSource] = useState<PendingParseSource>(null);
  const [lastEntryId, setLastEntryId] = useState(entryId);
  const [draftText, setDraftText] = useState(() => ({
    mainWorkout: normalizeText(mainWorkout),
    accessory: normalizeText(accessory),
  }));

  // Mirror the active preview URL so the unmount cleanup can revoke it
  // without re-running on every render. Other revoke paths (retake /
  // success / entry change) handle the URL synchronously inline.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = imagePreview?.url ?? null;
  }, [imagePreview?.url]);
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // Render-time reseed — when the editor is mounted on a different entry,
  // wipe transient state so a leftover preview / confirm doesn't bleed
  // across cards.
  if (entryId !== lastEntryId) {
    setLastEntryId(entryId);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview.url);
      setImagePreview(null);
    }
    setConfirmingParse(false);
    setPendingParseSource(null);
    setDraftText({
      mainWorkout: normalizeText(mainWorkout),
      accessory: normalizeText(accessory),
    });
  }

  const clearImagePreview = () => {
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const handleCapture = (img: CompressedImage) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url);
    setImagePreview({ url: img.previewUrl, base64: img.base64, mimeType: img.mimeType });
  };

  const triggerParseText = () => {
    onParseText({
      mainWorkout: draftText.mainWorkout.trim().length > 0 ? draftText.mainWorkout : null,
      accessory: draftText.accessory.trim().length > 0 ? draftText.accessory : null,
    });
  };

  const triggerParseImage = () => {
    if (!imagePreview) return;
    onParseImage({ imageBase64: imagePreview.base64, mimeType: imagePreview.mimeType });
    // Clear the preview eagerly — if the parse soft-fails the consumer's
    // toast surfaces the retry path; keeping a stale preview after a
    // dispatched parse confuses the UI more than dropping it does.
    clearImagePreview();
  };

  const handleParseTextClicked = () => {
    if (!hasSets) {
      triggerParseText();
      return;
    }
    setPendingParseSource("text");
    setConfirmingParse(true);
  };

  const handleParseImageClicked = () => {
    if (!hasSets) {
      triggerParseImage();
      return;
    }
    setPendingParseSource("image");
    setConfirmingParse(true);
  };

  const handleConfirmReplace = () => {
    setConfirmingParse(false);
    const source = pendingParseSource;
    setPendingParseSource(null);
    if (source === "image") triggerParseImage();
    else triggerParseText();
  };

  return (
    <>
      <CoachPrescriptionCollapsible
        title={title}
        compact={compact}
        defaultOpen={!hasSets}
        mainWorkout={mainWorkout}
        accessory={accessory}
        notes={notes}
        showNotes={showNotes}
        onSaveField={onSaveField}
        onDraftFieldChange={(field, value) => {
          if (field === "mainWorkout" || field === "accessory") {
            setDraftText((prev) => ({ ...prev, [field]: value }));
          }
        }}
        onParse={handleParseTextClicked}
        isParsing={isParsingText}
        onCapture={handleCapture}
        imagePreview={imagePreview ? { url: imagePreview.url } : null}
        onRetakeImage={clearImagePreview}
        onParseImage={handleParseImageClicked}
        isParsingImage={isParsingImage}
      />

      <AlertDialog open={confirmingParse} onOpenChange={setConfirmingParse}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing exercises?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingParseSource === "image"
                ? "Parsing this photo will replace the current structured exercises for this workout. Any manual edits you've made to the rows will be lost."
                : "Parsing the coach's text will replace the current structured exercises for this workout. Any manual edits you've made to the rows will be lost."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReplace}
              data-testid="prescription-parse-confirm"
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
