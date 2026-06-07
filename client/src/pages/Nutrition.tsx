import { MEAL_TYPES, type ParseMealResponse } from "@shared/schema";
import { ChefHat, ChevronLeft, ChevronRight, CopyPlus, Plus, ScanLine, Target } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageContainer } from "@/components/ui/PageContainer";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useDeleteLog, useNutritionDay, useNutritionTargets, useRepeatDay } from "@/hooks/useNutrition";

import { BarcodeScanner } from "./nutrition/BarcodeScanner";
import { CustomFoodDialog, type CustomFoodDialogState } from "./nutrition/CustomFoodDialog";
import { DailyTotalsHeader } from "./nutrition/DailyTotalsHeader";
import { DescribeMealButton } from "./nutrition/DescribeMealButton";
import { FoodSearch } from "./nutrition/FoodSearch";
import { type LogDialogState,LogFoodDialog } from "./nutrition/LogFoodDialog";
import { MealSection } from "./nutrition/MealSection";
import { MicronutrientPanel } from "./nutrition/MicronutrientPanel";
import { MyFoodsSection } from "./nutrition/MyFoodsSection";
import { NutritionInsightsPanel } from "./nutrition/NutritionInsightsPanel";
import { ParsedMealReviewSheet } from "./nutrition/ParsedMealReviewSheet";
import { QuickAddBar } from "./nutrition/QuickAddBar";
import { RecipeBuilderDialog } from "./nutrition/RecipeBuilderDialog";
import { SnapMealButton } from "./nutrition/SnapMealButton";
import { TargetsDialog } from "./nutrition/TargetsDialog";
import { addDays, formatDateLabel, MEAL_LABELS, todayStr } from "./nutrition/utils";

const EMPTY_TOTALS = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

/**
 * Nutrition tracking — Phase 1 daily log. Pick a day, see running macro totals,
 * search/quick-add foods, and edit/delete entries. Reached only when the
 * VITE_NUTRITION_ENABLED flag is on (route + nav are gated in App/AppSidebar).
 */
export default function Nutrition() {
  useDocumentTitle("Nutrition");
  const { isLoading: authLoading } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [dialog, setDialog] = useState<LogDialogState | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [customFood, setCustomFood] = useState<CustomFoodDialogState | null>(null);
  const [recipe, setRecipe] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [mealReview, setMealReview] = useState<{ result: ParseMealResponse; entryMethod: "nl" | "photo" } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);

  const day = useNutritionDay(date);
  const targets = useNutritionTargets();
  const currentTarget = targets.data?.current ?? null;
  const deleteLog = useDeleteLog(date);
  const repeatDay = useRepeatDay(date);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  const summary = day.data;
  const isEmpty = !!summary && MEAL_TYPES.every((m) => summary.meals[m].length === 0);

  let dayBody: ReactNode;
  if (day.isLoading) {
    dayBody = (
      <div className="flex justify-center p-6">
        <LoadingSpinner />
      </div>
    );
  } else if (isEmpty) {
    dayBody = (
      <div
        className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="text-empty-day"
      >
        <p>Nothing logged for {formatDateLabel(date).toLowerCase()}.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => repeatDay.mutate({ sourceDate: addDays(date, -1), targetDate: date })}
          disabled={repeatDay.isPending}
          data-testid="button-repeat-prev"
        >
          <CopyPlus className="mr-2 h-4 w-4" /> Repeat previous day
        </Button>
      </div>
    );
  } else {
    dayBody = (
      <div className="space-y-4">
        {MEAL_TYPES.map((m) => (
          <MealSection
            key={m}
            label={MEAL_LABELS[m]}
            entries={summary?.meals[m] ?? []}
            onEdit={(entry) => setDialog({ mode: "edit", entry })}
            onDelete={(id) => deleteLog.mutate(id)}
            deletingId={deleteLog.isPending ? deleteLog.variables : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Nutrition</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous day"
              onClick={() => setDate((d) => addDays(d, -1))}
              data-testid="button-prev-day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              type="button"
              className="min-w-24 text-center text-sm font-medium hover:underline"
              onClick={() => setDate(todayStr())}
              data-testid="button-date-label"
            >
              {formatDateLabel(date)}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next day"
              onClick={() => setDate((d) => addDays(d, 1))}
              data-testid="button-next-day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <DailyTotalsHeader totals={summary?.totals ?? EMPTY_TOTALS} target={currentTarget} />

        <FoodSearch onSelect={(food) => setDialog({ mode: "create", food })} />
        <QuickAddBar onSelect={(food) => setDialog({ mode: "create", food })} />

        <div className="flex flex-wrap gap-2">
          <DescribeMealButton onParsed={(r) => setMealReview({ result: r, entryMethod: "nl" })} />
          <SnapMealButton onParsed={(r) => setMealReview({ result: r, entryMethod: "photo" })} />
          <Button variant="outline" size="sm" onClick={() => setBarcodeOpen(true)} data-testid="button-scan-barcode">
            <ScanLine className="mr-2 h-4 w-4" /> Scan barcode
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCustomFood({ mode: "create" })} data-testid="button-new-custom-food">
            <Plus className="mr-2 h-4 w-4" /> Custom food
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRecipe({ open: true, id: null })} data-testid="button-new-recipe">
            <ChefHat className="mr-2 h-4 w-4" /> Recipe
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTargetsOpen(true)} data-testid="button-edit-targets">
            <Target className="mr-2 h-4 w-4" /> Targets
          </Button>
        </div>

        {dayBody}

        {summary && !isEmpty && <MicronutrientPanel date={date} />}

        <MyFoodsSection
          onEditFood={(food) => setCustomFood({ mode: "edit", food })}
          onEditRecipe={(id) => setRecipe({ open: true, id })}
        />

        <NutritionInsightsPanel />
      </div>

      <LogFoodDialog state={dialog} date={date} onClose={() => setDialog(null)} />
      <BarcodeScanner
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onResolved={(food) => setDialog({ mode: "create", food, entryMethod: "barcode" })}
      />
      <CustomFoodDialog state={customFood} onClose={() => setCustomFood(null)} />
      <RecipeBuilderDialog open={recipe.open} recipeId={recipe.id} onClose={() => setRecipe({ open: false, id: null })} />
      <ParsedMealReviewSheet
        result={mealReview?.result ?? null}
        date={date}
        entryMethod={mealReview?.entryMethod ?? "nl"}
        onClose={() => setMealReview(null)}
      />
      <TargetsDialog open={targetsOpen} current={currentTarget} onClose={() => setTargetsOpen(false)} />
    </PageContainer>
  );
}
