import type { Food, ParseMealResponse } from "@shared/schema";
import { MEAL_TYPES, type MealType } from "@shared/schema/enums";
import { ChevronLeft, ChevronRight, CopyPlus, Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageContainer } from "@/components/ui/PageContainer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  useDeleteLog,
  useFavorites,
  useNutritionDay,
  useNutritionTargets,
  usePortionMemory,
  useRecentFoods,
  useRepeatDay,
} from "@/hooks/useNutrition";

import { BarcodeScanner } from "./nutrition/BarcodeScanner";
import { CustomFoodDialog, type CustomFoodDialogState } from "./nutrition/CustomFoodDialog";
import { DailyTotalsHeader } from "./nutrition/DailyTotalsHeader";
import { DescribeMealDialog } from "./nutrition/DescribeMealDialog";
import { EnergyBalanceCard } from "./nutrition/EnergyBalanceCard";
import { FirstRunStarter } from "./nutrition/FirstRunStarter";
import { FoodSearch } from "./nutrition/FoodSearch";
import { LogFoodActions } from "./nutrition/LogFoodActions";
import { type LogDialogState, LogFoodDialog } from "./nutrition/LogFoodDialog";
import { MealSection } from "./nutrition/MealSection";
import { MealTargetDialog, type MealTargetDialogState } from "./nutrition/MealTargetDialog";
import { MicronutrientPanel } from "./nutrition/MicronutrientPanel";
import { MyFoodsSection } from "./nutrition/MyFoodsSection";
import { NutritionInsightsPanel } from "./nutrition/NutritionInsightsPanel";
import { ParsedMealReviewSheet } from "./nutrition/ParsedMealReviewSheet";
import { QuickAddBar } from "./nutrition/QuickAddBar";
import { RecipeBuilderDialog } from "./nutrition/RecipeBuilderDialog";
import { TargetsDialog } from "./nutrition/TargetsDialog";
import { addDays, formatDateLabel, MEAL_LABELS, todayStr } from "./nutrition/utils";

const EMPTY_TOTALS = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

/** Well-formed YYYY-MM-DD check (no regex — keeps off SonarCloud's regex hotspot rule). */
function isValidYmd(s: string): boolean {
  if (s.length !== 10 || s[4] !== "-" || s[7] !== "-") return false;
  const [y, m, d] = s.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** Initial day from an optional ?date=YYYY-MM-DD deep-link (the Timeline fuelling
 *  chip links here), falling back to today when absent or malformed. */
function initialDate(): string {
  const param = new URLSearchParams(globalThis.location.search).get("date");
  return param && isValidYmd(param) ? param : todayStr();
}

/** Initial meal seed from an optional ?meal= deep-link (the workout sheet's
 *  "Log recovery meal" links here with post_workout), else null. Seeds the
 *  meal picker of every log started this visit — arriving with intent to fuel
 *  a session shouldn't cost a per-food meal correction. */
function initialMealSeed(): MealType | null {
  const param = new URLSearchParams(globalThis.location.search).get("meal");
  return param && (MEAL_TYPES as readonly string[]).includes(param) ? (param as MealType) : null;
}

/**
 * Nutrition tracking — Phase 1 daily log. Pick a day, see running macro totals,
 * search/quick-add foods, and edit/delete entries. Reached only when the
 * VITE_NUTRITION_ENABLED flag is on (route + nav are gated in App/AppSidebar).
 */
export default function Nutrition() {
  useDocumentTitle("Nutrition");
  const { isLoading: authLoading } = useAuth();
  const [date, setDate] = useState(initialDate);
  const [mealSeed] = useState(initialMealSeed);
  const [dialog, setDialog] = useState<LogDialogState | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [customFood, setCustomFood] = useState<CustomFoodDialogState | null>(null);
  const [recipe, setRecipe] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [mealReview, setMealReview] = useState<{
    result: ParseMealResponse;
    entryMethod: "nl" | "photo";
  } | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [mealTargetEdit, setMealTargetEdit] = useState<MealTargetDialogState | null>(null);

  const day = useNutritionDay(date);
  const targets = useNutritionTargets();
  const currentTarget = targets.data?.current ?? null;
  const deleteLog = useDeleteLog(date);
  const repeatDay = useRepeatDay(date);
  const portionMemory = usePortionMemory();
  // First-run detection for the guided starter: an athlete with no recents and
  // no favourites has never logged, so "Repeat previous day" can only 404.
  // Both queries are already in flight for the quick-add bar / portion memory.
  const recentFoods = useRecentFoods();
  const favoriteFoods = useFavorites();
  const isFirstRun =
    recentFoods.isSuccess &&
    favoriteFoods.isSuccess &&
    recentFoods.data.length === 0 &&
    favoriteFoods.data.length === 0;

  // Every "log this food" entry point goes through here so a food the athlete
  // has logged before opens pre-filled with the portion they actually use —
  // including one reached from search, not just from the quick-add chips.
  const openCreateDialog = useCallback(
    (food: Food, entryMethod?: "manual" | "barcode") =>
      setDialog({
        mode: "create",
        food,
        entryMethod,
        portionHint: portionMemory(food.id),
        mealOverride: mealSeed ?? undefined,
      }),
    [portionMemory, mealSeed],
  );

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  const summary = day.data;
  const isEmpty = !!summary && MEAL_TYPES.every((m) => summary.meals[m].length === 0);
  const hasMealTargets = !!summary?.mealTargets;

  const repeatPrevButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => repeatDay.mutate({ sourceDate: addDays(date, -1), targetDate: date })}
      disabled={repeatDay.isPending}
      data-testid="button-repeat-prev"
    >
      {repeatDay.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <CopyPlus className="mr-2 h-4 w-4" aria-hidden="true" />
      )}
      {repeatDay.isPending ? "Repeating…" : "Repeat previous day"}
    </Button>
  );

  // A first-run athlete gets the guided starter wherever the repeat shortcut
  // would show — repeating an empty history is the one action that can't work.
  const firstRunStarter = (
    <FirstRunStarter
      onDescribe={() => setDescribeOpen(true)}
      onScanBarcode={() => setBarcodeOpen(true)}
      onSetTargets={() => setTargetsOpen(true)}
      hasTarget={currentTarget !== null}
    />
  );

  let dayBody: ReactNode;
  if (day.isLoading) {
    dayBody = (
      <div className="flex justify-center p-6">
        <LoadingSpinner />
      </div>
    );
  } else if (isEmpty && !hasMealTargets) {
    // Nothing logged and no targets to plan around — the classic empty prompt.
    dayBody = isFirstRun ? (
      firstRunStarter
    ) : (
      <div
        className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="text-empty-day"
      >
        <p>Nothing logged for {formatDateLabel(date).toLowerCase()}.</p>
        <div className="mt-3">{repeatPrevButton}</div>
      </div>
    );
  } else {
    // Render the meal sections — per-meal fuel targets show even before anything
    // is logged. Offer a compact repeat shortcut while the day is still empty.
    dayBody = (
      <div className="space-y-4">
        {MEAL_TYPES.map((m) => (
          <MealSection
            key={m}
            label={MEAL_LABELS[m]}
            mealType={m}
            entries={summary?.meals[m] ?? []}
            target={summary?.mealTargets?.[m] ?? null}
            onEdit={(entry) => setDialog({ mode: "edit", entry })}
            onDelete={(id) => deleteLog.mutate(id)}
            deletingId={deleteLog.isPending ? deleteLog.variables : undefined}
            onEditTarget={(m) => {
              const t = summary?.mealTargets?.[m];
              if (t) {
                setMealTargetEdit({
                  mealType: m,
                  target: t,
                  isOverridden: t.reasonCodes.includes("user_override"),
                });
              }
            }}
          />
        ))}
        {isEmpty &&
          (isFirstRun ? (
            firstRunStarter
          ) : (
            <div className="flex justify-center">{repeatPrevButton}</div>
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous day"
                    onClick={() => setDate((d) => addDays(d, -1))}
                    data-testid="button-prev-day"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Previous day</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              className="min-w-24 text-center text-sm font-medium"
              onClick={() => setDate(todayStr())}
              aria-label={`Currently viewing ${formatDateLabel(date)}, click to jump to today`}
              data-testid="button-date-label"
            >
              {formatDateLabel(date)}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next day"
                    onClick={() => setDate((d) => addDays(d, 1))}
                    data-testid="button-next-day"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Next day</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span
            role="status"
            aria-live="polite"
            className="sr-only"
            data-testid="date-announcement"
          >
            Viewing {formatDateLabel(date)}
          </span>
        </div>

        <DailyTotalsHeader
          totals={summary?.totals ?? EMPTY_TOTALS}
          effectiveTarget={summary?.effectiveTarget ?? null}
          onSetTargets={() => setTargetsOpen(true)}
        />
        <EnergyBalanceCard energy={summary?.energy ?? null} />

        <FoodSearch onSelect={openCreateDialog} />
        <QuickAddBar onSelect={openCreateDialog} date={date} />

        <LogFoodActions
          onDescribe={() => setDescribeOpen(true)}
          onScanBarcode={() => setBarcodeOpen(true)}
          onMealParsed={(r) => setMealReview({ result: r, entryMethod: "photo" })}
          onLabelExtracted={(r) => setCustomFood({ mode: "create", prefill: r })}
          onCustomFood={() => setCustomFood({ mode: "create" })}
          onRecipe={() => setRecipe({ open: true, id: null })}
          onTargets={() => setTargetsOpen(true)}
        />

        {dayBody}

        {summary && !isEmpty && <MicronutrientPanel date={date} />}

        <MyFoodsSection
          onEditFood={(food) => setCustomFood({ mode: "edit", food })}
          onEditRecipe={(id) => setRecipe({ open: true, id })}
        />

        <NutritionInsightsPanel />
      </div>

      <LogFoodDialog
        state={dialog}
        date={date}
        onClose={() => setDialog(null)}
        todayTotals={summary?.totals ?? EMPTY_TOTALS}
        effectiveTarget={summary?.effectiveTarget ?? null}
      />
      <BarcodeScanner
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onResolved={(food) => openCreateDialog(food, "barcode")}
      />
      <CustomFoodDialog
        state={customFood}
        onClose={() => setCustomFood(null)}
        // "Save & log" (label-scan flow): chain into LogFoodDialog with the
        // just-created food, exactly like a resolved barcode.
        onCreated={openCreateDialog}
      />
      <RecipeBuilderDialog
        open={recipe.open}
        recipeId={recipe.id}
        onClose={() => setRecipe({ open: false, id: null })}
      />
      <ParsedMealReviewSheet
        result={mealReview?.result ?? null}
        date={date}
        entryMethod={mealReview?.entryMethod ?? "nl"}
        onClose={() => setMealReview(null)}
      />
      {/* Page-level describe dialog so the first-run starter can open it. */}
      <DescribeMealDialog
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        onParsed={(r) => setMealReview({ result: r, entryMethod: "nl" })}
      />
      <TargetsDialog
        open={targetsOpen}
        current={currentTarget}
        onClose={() => setTargetsOpen(false)}
      />
      <MealTargetDialog
        date={date}
        state={mealTargetEdit}
        onClose={() => setMealTargetEdit(null)}
      />
    </PageContainer>
  );
}
