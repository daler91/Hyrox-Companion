import { type Food, MEAL_TYPES, type MealType, type ParsedFoodItem, type ParseMealResponse } from "@shared/schema";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogMealBatch } from "@/hooks/useNutrition";

import { FoodSearch } from "./FoodSearch";
import { loggedAtForDate, MEAL_LABELS, previewNutrition } from "./utils";

// A local, editable copy of a parsed item. `food` starts from the server's
// resolution and can be swapped; unmatched rows (food === null) can't be logged.
interface ReviewRow {
  key: string;
  displayAmount: string;
  quantityG: number;
  mealType: MealType;
  confidence: number;
  food: Food | null;
}

function toRows(items: ParsedFoodItem[]): ReviewRow[] {
  return items.map((item, i) => ({
    key: `${i}-${item.name}`,
    displayAmount: item.displayAmount || item.name,
    quantityG: Math.round(item.quantityG),
    mealType: item.mealType ?? "snack",
    confidence: item.confidence,
    food: item.food,
  }));
}

function isLoggable(row: ReviewRow): boolean {
  return row.food !== null && Number.isFinite(row.quantityG) && row.quantityG > 0;
}

function ReviewRowCard({
  row,
  index,
  swapOpen,
  onUpdate,
  onRemove,
  onSwapToggle,
  onSwap,
}: {
  readonly row: ReviewRow;
  readonly index: number;
  readonly swapOpen: boolean;
  readonly onUpdate: (patch: Partial<ReviewRow>) => void;
  readonly onRemove: () => void;
  readonly onSwapToggle: (open: boolean) => void;
  readonly onSwap: (food: Food) => void;
}) {
  const preview = row.food && isLoggable(row) ? previewNutrition(row.food, row.quantityG) : null;

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`meal-review-row-${index}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.displayAmount}</p>
          {row.food ? (
            <p className="truncate text-xs text-muted-foreground" data-testid={`meal-review-food-${index}`}>
              {row.food.name}
              {row.food.brand ? ` · ${row.food.brand}` : ""}
            </p>
          ) : (
            <p className="text-xs text-amber-600" data-testid={`meal-review-unmatched-${index}`}>
              No match — choose a food to log this.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${row.displayAmount}`}
          onClick={onRemove}
          data-testid={`meal-review-remove-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          className="w-20"
          value={Number.isFinite(row.quantityG) ? row.quantityG : ""}
          onChange={(e) => onUpdate({ quantityG: Number(e.target.value) })}
          aria-label="Quantity in grams"
          data-testid={`meal-review-grams-${index}`}
        />
        <span className="text-xs text-muted-foreground">g</span>
        <Select value={row.mealType} onValueChange={(v) => onUpdate({ mealType: v as MealType })}>
          <SelectTrigger className="flex-1" data-testid={`meal-review-meal-${index}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEAL_TYPES.map((m) => (
              <SelectItem key={m} value={m}>
                {MEAL_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preview && (
        <p className="text-xs tabular-nums text-muted-foreground" data-testid={`meal-review-preview-${index}`}>
          {preview.calories} kcal · P{preview.protein} C{preview.carb} F{preview.fat}
        </p>
      )}

      {swapOpen ? (
        <div className="space-y-1">
          <FoodSearch onSelect={onSwap} />
          <Button variant="ghost" size="sm" onClick={() => onSwapToggle(false)}>
            Done
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSwapToggle(true)}
          data-testid={`meal-review-swap-${index}`}
        >
          {row.food ? "Change food" : "Find a match"}
        </Button>
      )}
    </div>
  );
}

function ReviewForm({
  result,
  date,
  entryMethod,
  onClose,
}: {
  readonly result: ParseMealResponse;
  readonly date: string;
  readonly entryMethod: "nl" | "photo";
  readonly onClose: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(() => toRows(result.items));
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const logBatch = useLogMealBatch(date);

  const update = (i: number, patch: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const loggable = rows.filter(isLoggable);
  const unresolved = rows.length - loggable.length;
  const canLog = loggable.length > 0 && !logBatch.isPending;
  const logButtonLabel = `Log ${loggable.length} item${loggable.length === 1 ? "" : "s"}`;

  const submit = () => {
    if (loggable.length === 0) return;
    logBatch.mutate(
      {
        entryMethod,
        rawInput: result.rawInput,
        loggedAt: loggedAtForDate(date),
        items: loggable.map((r) => ({
          // food is non-null for loggable rows (isLoggable guards it).
          foodId: r.food!.id,
          quantityG: r.quantityG,
          mealType: r.mealType,
          parseConfidence: r.confidence,
        })),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review parsed foods</DialogTitle>
      </DialogHeader>

      {result.warnings.length > 0 && (
        <div
          className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="meal-review-warnings"
        >
          {result.warnings.join(" · ")}
        </div>
      )}

      <div className="max-h-[55vh] space-y-3 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="meal-review-empty">
            No foods detected. Try describing the meal differently.
          </p>
        ) : (
          rows.map((row, i) => (
            <ReviewRowCard
              key={row.key}
              row={row}
              index={i}
              swapOpen={swapIndex === i}
              onUpdate={(patch) => update(i, patch)}
              onRemove={() => remove(i)}
              onSwapToggle={(open) => setSwapIndex(open ? i : null)}
              onSwap={(food) => {
                update(i, { food });
                setSwapIndex(null);
              }}
            />
          ))
        )}
      </div>

      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        {unresolved > 0 && (
          <span className="text-xs text-muted-foreground">
            {unresolved} item{unresolved === 1 ? "" : "s"} need a match and won&apos;t be logged.
          </span>
        )}
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="ghost" onClick={onClose} disabled={logBatch.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canLog} data-testid="button-log-meal-batch">
            {logBatch.isPending ? "Logging…" : logButtonLabel}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/**
 * Review + confirm sheet for AI-parsed meals (FR-4.1). Lists each suggested food
 * with an editable quantity, meal, and swappable food match; only matched rows
 * are logged, in one batch, when the user confirms.
 */
export function ParsedMealReviewSheet({
  result,
  date,
  entryMethod,
  onClose,
}: {
  readonly result: ParseMealResponse | null;
  readonly date: string;
  readonly entryMethod: "nl" | "photo";
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-meal-review">
        {result && (
          <ReviewForm key={result.rawInput} result={result} date={date} entryMethod={entryMethod} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
