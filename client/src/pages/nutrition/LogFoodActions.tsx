import type { ParseLabelResponse, ParseMealResponse } from "@shared/schema";
import { ChefHat, Loader2, Plus, ScanLine, Sparkles, Target } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useToast } from "@/hooks/use-toast";
import {
  type ParseImageInput,
  useParseMealPhoto,
  useParseNutritionLabel,
} from "@/hooks/useNutrition";

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
 * as they do so; the photo rows stay put until their parse resolves, showing
 * its progress.
 *
 * The photo parses are owned here, not by their rows: the sheet can be
 * dismissed during the 5-15 s vision call, and once a row unmounted TanStack
 * skipped its mutate-level onSuccess, so the billed parse finished with no
 * review sheet or toast. This component lives as long as the page, so the
 * result still lands, and the Log food button shows the parse is running.
 * CL31 (CODEBASE_ANALYSIS_2026-10-03)
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
  const parseMeal = useParseMealPhoto();
  const parseLabel = useParseNutritionLabel();
  const { toast } = useToast();
  const parsing = parseMeal.isPending || parseLabel.isPending;

  const closeAnd = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const snapMeal = (image: ParseImageInput) => {
    parseMeal.mutate(image, {
      onSuccess: (result) => {
        setOpen(false);
        onMealParsed(result);
      },
    });
  };

  const scanLabel = (image: ParseImageInput) => {
    parseLabel.mutate(image, {
      onSuccess: (result) => {
        if (result.label === null) {
          toast({
            title: "No nutrition label found",
            description: "Try a closer, well-lit photo of the nutrition facts panel.",
            variant: "destructive",
          });
          return;
        }
        setOpen(false);
        onLabelExtracted(result);
      },
    });
  };

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
        aria-busy={parsing}
        data-testid="button-log-food"
      >
        {parsing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        Log food
      </Button>
      <span role="status" aria-live="polite" className="sr-only" data-testid="status-photo-parse">
        {parsing ? "Reading your photo" : ""}
      </span>

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
            onImage={snapMeal}
            isParsing={parseMeal.isPending}
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
            onImage={scanLabel}
            isParsing={parseLabel.isPending}
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
