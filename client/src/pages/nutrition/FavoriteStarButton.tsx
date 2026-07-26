import { Star } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFavoriteIds, useToggleFavorite } from "@/hooks/useNutrition";
import { cn } from "@/lib/utils";

interface FavoriteStarButtonProps {
  readonly foodId: string;
  /** Used for the accessible label only. */
  readonly foodName: string;
  /** `sm` for the tighter action groups inside the log dialog and search rows. */
  readonly size?: "default" | "sm";
}

/**
 * Star a food so it shows up in the quick-add row.
 *
 * One component across every food surface — search results, meal rows, my
 * foods, the log dialog — so the control means the same thing wherever the
 * athlete meets it.
 *
 * The flip is held locally while the write is in flight rather than written
 * into the favourites cache: a meal row knows only a food's id and name, which
 * is not enough to synthesise the full Food that list holds. The athlete sees
 * the star change instantly either way, and the refetch settles the truth.
 */
export function FavoriteStarButton({
  foodId,
  foodName,
  size = "default",
}: Readonly<FavoriteStarButtonProps>) {
  const favoriteIds = useFavoriteIds();
  const toggleFavorite = useToggleFavorite();
  const [pendingIntent, setPendingIntent] = useState<boolean | null>(null);

  const isFavorite = pendingIntent ?? favoriteIds.has(foodId);
  const label = isFavorite ? `Remove ${foodName} from favourites` : `Add ${foodName} to favourites`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(size === "sm" && "h-7 w-7 shrink-0")}
            aria-label={label}
            aria-pressed={isFavorite}
            onClick={(event) => {
              // These sit inside clickable rows on some surfaces; starring must
              // not also open the log dialog.
              event.stopPropagation();
              setPendingIntent(!isFavorite);
              toggleFavorite.mutate(
                { foodId, isFavorite },
                // Hand back to the query once it has the answer — on failure
                // that restores the true state, which is the rollback.
                { onSettled: () => setPendingIntent(null) },
              );
            }}
            data-testid={`favorite-toggle-${foodId}`}
          >
            <Star
              className={cn("h-4 w-4", isFavorite && "fill-current text-amber-500")}
              aria-hidden="true"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isFavorite ? "Remove from favourites" : "Add to favourites"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
