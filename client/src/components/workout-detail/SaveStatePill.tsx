import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface SaveState {
  readonly isSaving: boolean;
  readonly lastSavedAt: number | null;
  /**
   * Timestamp of the most recent failed save, if any. When it's newer than
   * `lastSavedAt` (and nothing is in flight) the pill shows "Couldn't save"
   * so a silently-rolled-back edit never reads as saved. A later successful
   * save bumps `lastSavedAt` past it and the pill returns to "Saved".
   */
  readonly lastSaveErrorAt?: number | null;
}

const SAVE_FLASH_MS = 1500;

export function SaveStatePill({
  state,
  testId = "save-state-pill",
}: Readonly<{ state: SaveState; testId?: string }>) {
  if (state.isSaving) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        aria-live="polite"
        role="status"
        data-testid={testId}
        data-state="saving"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  const showError =
    state.lastSaveErrorAt != null &&
    (state.lastSavedAt == null || state.lastSaveErrorAt > state.lastSavedAt);
  if (showError) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-destructive"
        aria-live="assertive"
        role="status"
        data-testid={testId}
        data-state="error"
      >
        <AlertTriangle className="size-3" aria-hidden />
        Couldn't save
      </span>
    );
  }
  if (state.lastSavedAt == null) return null;
  return <SaveFlashBadge key={state.lastSavedAt} testId={testId} />;
}

export function SaveFlashBadge({
  testId = "save-flash-badge",
}: Readonly<{ testId?: string }>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), SAVE_FLASH_MS);
    return () => clearTimeout(id);
  }, []);
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400"
      aria-live="polite"
      role="status"
      data-testid={testId}
      data-state="saved"
    >
      <Check className="size-3" aria-hidden />
      Saved
    </span>
  );
}
