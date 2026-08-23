import type { MealType } from "@shared/schema/enums";
import { useState } from "react";

import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useDeleteLog, useLogFood } from "@/hooks/useNutrition";

import { loggedAtForDate, MEAL_LABELS } from "./utils";

/** Prevents double-tap: disables itself after the first click. */
function UndoToastAction({
  name,
  onUndo,
}: {
  readonly name: string;
  readonly onUndo: () => void;
}) {
  const [fired, setFired] = useState(false);
  return (
    <ToastAction
      altText={`Undo logging ${name}`}
      onClick={() => {
        if (fired) return;
        setFired(true);
        onUndo();
      }}
      disabled={fired}
      data-testid="button-undo-quickadd"
    >
      {fired ? "Undoing…" : "Undo"}
    </ToastAction>
  );
}

export interface QuickLogItem {
  foodId: string;
  name: string;
  quantityG: number;
  mealType: MealType;
}

/**
 * One-tap logging with an undo toast: log a known food/portion/meal onto
 * `date` without opening the dialog. The confirm step is friction with no
 * decision in it when the portion is already known — the undo action covers
 * the mis-tap instead. Shared by the favourites quick-add chips and the
 * meal rows' "log again".
 */
export function useQuickLog(date: string): {
  quickLog: (item: QuickLogItem) => void;
  isPending: boolean;
} {
  const logFood = useLogFood(date);
  const deleteLog = useDeleteLog(date);
  const { toast } = useToast();

  const quickLog = (item: QuickLogItem) => {
    logFood.mutate(
      {
        foodId: item.foodId,
        quantityG: item.quantityG,
        mealType: item.mealType,
        loggedAt: loggedAtForDate(date),
      },
      {
        onSuccess: (result) => {
          // A queued offline write has no id to undo yet; its own toast already
          // explains that it will sync.
          if (result.status !== "saved") return;
          const entryId = result.data.id;
          toast({
            title: "Food logged",
            description: `${item.name} · ${Math.round(item.quantityG)} g · ${MEAL_LABELS[item.mealType]}`,
            action: (
              <UndoToastAction
                name={item.name}
                onUndo={() => deleteLog.mutate(entryId)}
              />
            ),
          });
        },
      },
    );
  };

  return { quickLog, isPending: logFood.isPending };
}
