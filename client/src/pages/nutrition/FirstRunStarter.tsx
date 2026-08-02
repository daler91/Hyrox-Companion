import { ScanLine, Sparkles, Target } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Guided empty state for an athlete who has never logged a food.
 *
 * The generic empty day offers "Repeat previous day", which for a first-run
 * user is guaranteed to 404 (there is nothing to repeat) — a dead end on the
 * very first visit. Instead, lead with the lowest-effort first log (describe
 * a meal in plain English), with barcode scan and target setup as the
 * supporting paths. The caller decides first-run-ness (no recents and no
 * favourites) and swaps this in for the repeat shortcut.
 */
export function FirstRunStarter({
  onDescribe,
  onScanBarcode,
  onSetTargets,
  hasTarget,
}: {
  readonly onDescribe: () => void;
  readonly onScanBarcode: () => void;
  readonly onSetTargets: () => void;
  /** A daily target already exists, so don't pitch setting one. */
  readonly hasTarget: boolean;
}) {
  return (
    <div
      className="rounded-md border border-dashed p-6 text-center"
      data-testid="first-run-starter"
    >
      <p className="text-sm font-medium">Log your first meal</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Type what you ate in plain English and we&apos;ll work out the foods and macros — it takes
        about 20 seconds.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button onClick={onDescribe} data-testid="starter-describe-meal">
          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Describe your last meal
        </Button>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onScanBarcode}
            data-testid="starter-scan-barcode"
          >
            <ScanLine className="mr-2 h-4 w-4" aria-hidden="true" /> Scan a barcode
          </Button>
          {!hasTarget && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSetTargets}
              data-testid="starter-set-targets"
            >
              <Target className="mr-2 h-4 w-4" aria-hidden="true" /> Set your targets
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
