import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface SaveState {
  readonly isSaving: boolean;
  readonly lastSavedAt: number | null;
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
