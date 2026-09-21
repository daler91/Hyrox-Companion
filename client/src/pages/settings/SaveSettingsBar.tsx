import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Sticky save bar, rendered only while some tab has unsaved preference edits.
 * It lives outside the Settings tabs so edits made on any tab are saved by
 * the one button and survive tab switches.
 */
export function SaveSettingsBar({
  hasChanges,
  isSaving,
  onSave,
}: Readonly<{ hasChanges: boolean; isSaving: boolean; onSave: () => void }>) {
  if (!hasChanges) return null;

  return (
    <div
      className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-3 border-t bg-background/95 backdrop-blur z-40 animate-in slide-in-from-bottom-2 fade-in-0 duration-200"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">You have unsaved changes.</span>
      <Button
        onClick={onSave}
        className="w-full"
        data-testid="button-save-settings"
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
            Saving...
          </>
        ) : (
          "Save Settings"
        )}
      </Button>
    </div>
  );
}
