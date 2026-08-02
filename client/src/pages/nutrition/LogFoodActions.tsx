import type { ParseLabelResponse, ParseMealResponse } from "@shared/schema";
import { ChefHat, Plus, ScanLine, Sparkles, Target } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";

import { ScanLabelButton } from "./ScanLabelButton";
import { SnapMealButton } from "./SnapMealButton";

/**
 * The page's single "Log food" entry point, replacing a row of seven visually
 * identical outline buttons that gave a first-time user no obvious door in.
 *
 * One primary button opens a method sheet: the four ways to capture a food
 * (describe / photo / barcode / label) as full-width rows, with the
 * create-and-manage actions (custom food, recipe, targets) as a compact
 * secondary row below. Rows that hand off to another surface close the sheet
 * as they do so; the photo rows stay put until their parse resolves, since
 * their loading state lives on the row itself.
 */
export function LogFoodActions({
  onDescribe,
  onScanBarcode,
  onMealParsed,
  onLabelExtracted,
  onCustomFood,
  onRecipe,
  onTargets,
}: {
  readonly onDescribe: () => void;
  readonly onScanBarcode: () => void;
  readonly onMealParsed: (result: ParseMealResponse) => void;
  readonly onLabelExtracted: (result: ParseLabelResponse) => void;
  readonly onCustomFood: () => void;
  readonly onRecipe: () => void;
  readonly onTargets: () => void;
}) {
  const [open, setOpen] = useState(false);

  const closeAnd = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="button-log-food">
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Log food
      </Button>

      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="Log food"
        description="Pick the fastest way to capture what you ate."
        testId="sheet-log-food"
      >
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={closeAnd(onDescribe)}
            data-testid="menu-describe-meal"
          >
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Describe a meal
          </Button>
          <SnapMealButton
            size="default"
            className="w-full justify-start"
            onParsed={(r) => {
              setOpen(false);
              onMealParsed(r);
            }}
          />
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={closeAnd(onScanBarcode)}
            data-testid="menu-scan-barcode"
          >
            <ScanLine className="mr-2 h-4 w-4" aria-hidden="true" /> Scan a barcode
          </Button>
          <ScanLabelButton
            size="default"
            className="w-full justify-start"
            onExtracted={(r) => {
              setOpen(false);
              onLabelExtracted(r);
            }}
          />
        </div>

        <div className="mt-4 space-y-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Create &amp; manage</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={closeAnd(onCustomFood)}
              data-testid="menu-custom-food"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Custom food
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeAnd(onRecipe)}
              data-testid="menu-recipe"
            >
              <ChefHat className="mr-2 h-4 w-4" aria-hidden="true" /> Recipe
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeAnd(onTargets)}
              data-testid="menu-targets"
            >
              <Target className="mr-2 h-4 w-4" aria-hidden="true" /> Targets
            </Button>
          </div>
        </div>
      </ResponsiveSheet>
    </>
  );
}
