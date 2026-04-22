import type { AllowedImageMimeType } from "@shared/schema";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import type { ParseFromImagePayload, ReparseResponse } from "@/lib/api";

export type PendingParseSource = "text" | "image" | null;

export interface DialogParseControlsInput {
  readonly entryId: string;
  readonly isPlanned: boolean;
  readonly hasSets: boolean;
  readonly planSets: ReturnType<typeof usePlanDayExercises>;
  readonly onParseLoggedFreeText: (opts?: { onSuccess?: () => void }) => void;
  readonly isParsingLogged: boolean;
  readonly onParseLoggedFromImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (data: ReparseResponse) => void },
  ) => void;
  readonly isParsingLoggedImage: boolean;
}

export interface DialogParseControls {
  readonly prescriptionOpen: boolean;
  readonly setPrescriptionOpen: (open: boolean) => void;
  readonly confirmingParse: boolean;
  readonly setConfirmingParse: (open: boolean) => void;
  readonly pendingParseSource: PendingParseSource;
  readonly imagePreview: { readonly url: string; readonly error?: string | null } | null;
  readonly isParsing: boolean;
  readonly isParsingImage: boolean;
  readonly onParseClicked: () => void;
  readonly onParseImageClicked: () => void;
  readonly onCapture: (img: {
    previewUrl: string;
    base64: string;
    mimeType: AllowedImageMimeType;
  }) => void;
  readonly clearImagePreview: () => void;
  readonly confirmReplace: () => void;
}

interface ImagePreviewState {
  readonly url: string;
  readonly base64: string;
  readonly mimeType: AllowedImageMimeType;
}

/**
 * Hosts the parse orchestration (text + image) for WorkoutDetailDialogV2.
 *
 * Lives in its own hook so `DialogBody` stays below Sonar's function-length
 * and cognitive-complexity ceilings. The state model is the same as before
 * the extraction:
 *
 * - `prescriptionOpen` drives the free-text collapsible. Auto-collapses on
 *   successful parse (either source); opens on a fresh capture so the user
 *   sees the preview; resets on entry change.
 * - `imagePreview` holds the captured photo. Lifetime includes the blob
 *   URL which we revoke on retake, success, or entry change.
 * - `confirmingParse` + `pendingParseSource` drive the replace-confirm
 *   AlertDialog — when sets already exist we ask the user before either
 *   parse source blows them away.
 *
 * Render-time sentinels reset per-entry state without a useEffect, matching
 * the `lastEntryId` pattern elsewhere in the parent component.
 */
export function useDialogParseControls(input: DialogParseControlsInput): DialogParseControls {
  const {
    entryId,
    isPlanned,
    hasSets,
    planSets,
    onParseLoggedFreeText,
    isParsingLogged,
    onParseLoggedFromImage,
    isParsingLoggedImage,
  } = input;

  const [confirmingParse, setConfirmingParse] = useState(false);
  const [pendingParseSource, setPendingParseSource] = useState<PendingParseSource>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [prescriptionOpen, setPrescriptionOpen] = useState<boolean>(isPlanned && !hasSets);
  const [prescriptionHydrated, setPrescriptionHydrated] = useState<boolean>(hasSets);
  const [lastEntryId, setLastEntryId] = useState<string>(entryId);

  // Late-landing mutation success handlers compare against this ref so they
  // only mutate state (clear preview / collapse panel) when the user is
  // still looking at the entry the parse was dispatched on. Updated in
  // useLayoutEffect (not useEffect) — effects flush AFTER the commit task
  // returns to the event loop, leaving a window where pending Promise
  // microtasks (TanStack Query's onSuccess) drain BEFORE the ref updates.
  // useLayoutEffect runs synchronously within the commit task so no
  // microtask can interleave between render and ref sync.
  const currentEntryIdRef = useRef(entryId);
  useLayoutEffect(() => {
    currentEntryIdRef.current = entryId;
  }, [entryId]);

  // Mirror the active preview URL so a single unmount-only effect can
  // revoke it. The other revoke paths (retake / success / entry change /
  // replace-on-recapture) handle the URL synchronously, so this only
  // matters when the dialog closes while a capture is sitting unparsed.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = imagePreview?.url ?? null;
  }, [imagePreview?.url]);
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  if (entryId !== lastEntryId) {
    setLastEntryId(entryId);
    setPrescriptionOpen(isPlanned && !hasSets);
    setPrescriptionHydrated(hasSets);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview.url);
      setImagePreview(null);
    }
    setConfirmingParse(false);
    setPendingParseSource(null);
  } else if (isPlanned && !prescriptionHydrated && hasSets) {
    setPrescriptionHydrated(true);
    setPrescriptionOpen(false);
  }

  const clearImagePreview = () => {
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const onCapture = (img: {
    previewUrl: string;
    base64: string;
    mimeType: AllowedImageMimeType;
  }) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url);
    setImagePreview({ url: img.previewUrl, base64: img.base64, mimeType: img.mimeType });
    setPrescriptionOpen(true);
  };

  const isParsing = isPlanned ? planSets.reparseFreeText.isPending : isParsingLogged;
  const isParsingImage = isPlanned ? planSets.reparseFromImage.isPending : isParsingLoggedImage;

  const triggerParseText = () => {
    // Snapshot the entry id at dispatch time; ignore the success callback
    // if the user navigated away while the parse was in flight.
    const dispatchedEntryId = entryId;
    const onSuccess = () => {
      if (currentEntryIdRef.current !== dispatchedEntryId) return;
      setPrescriptionOpen(false);
    };
    if (isPlanned) planSets.reparseFreeText.mutate(undefined, { onSuccess });
    else onParseLoggedFreeText({ onSuccess });
  };

  const triggerParseImage = () => {
    if (!imagePreview) return;
    const dispatchedEntryId = entryId;
    const payload = { imageBase64: imagePreview.base64, mimeType: imagePreview.mimeType };
    const onSuccess = (data: ReparseResponse) => {
      // Guard against a late-landing success after the user navigated:
      // clearing preview / collapsing the panel would corrupt the now-
      // current entry's state.
      if (currentEntryIdRef.current !== dispatchedEntryId) return;
      // Soft-failure guard: the stateful reparse endpoints return 200
      // with saved=false when Gemini extracted no exercises. Keep the
      // preview so the user can retake/retry from the same capture
      // instead of recapturing.
      if (!data.saved) return;
      clearImagePreview();
      setPrescriptionOpen(false);
    };
    if (isPlanned) planSets.reparseFromImage.mutate(payload, { onSuccess });
    else onParseLoggedFromImage(payload, { onSuccess });
  };

  const onParseClicked = () => {
    if (!hasSets) {
      triggerParseText();
      return;
    }
    setPendingParseSource("text");
    setConfirmingParse(true);
  };

  const onParseImageClicked = () => {
    if (!hasSets) {
      triggerParseImage();
      return;
    }
    setPendingParseSource("image");
    setConfirmingParse(true);
  };

  const confirmReplace = () => {
    setConfirmingParse(false);
    const source = pendingParseSource;
    setPendingParseSource(null);
    if (source === "image") triggerParseImage();
    else triggerParseText();
  };

  return {
    prescriptionOpen,
    setPrescriptionOpen,
    confirmingParse,
    setConfirmingParse,
    pendingParseSource,
    imagePreview: imagePreview ? { url: imagePreview.url } : null,
    isParsing,
    isParsingImage,
    onParseClicked,
    onParseImageClicked,
    onCapture,
    clearImagePreview,
    confirmReplace,
  };
}
