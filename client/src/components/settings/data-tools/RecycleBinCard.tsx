import type { RecycleBinEntityType, RecycleBinListItem } from "@shared/schema";
import { differenceInCalendarDays, formatDistanceToNow } from "date-fns";
import { CalendarDays, ClipboardList, Dumbbell, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useEmptyRecycleBin,
  usePurgeRecycleBinItem,
  useRecycleBin,
  useRestoreRecycleBinItem,
} from "@/hooks/useRecycleBin";

const TYPE_LABEL: Record<RecycleBinEntityType, string> = {
  workout_log: "Workout",
  plan_day: "Plan day",
  training_plan: "Training plan",
};

const TYPE_ICON: Record<RecycleBinEntityType, typeof Dumbbell> = {
  workout_log: Dumbbell,
  plan_day: CalendarDays,
  training_plan: ClipboardList,
};

function expiryCopy(expiresAt: string, now: Date): string {
  const days = differenceInCalendarDays(new Date(expiresAt), now);
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}

function RecycleBinRow({
  item,
  now,
  onRestore,
  onPurge,
  isRestoring,
  isPurging,
}: Readonly<{
  item: RecycleBinListItem;
  now: Date;
  onRestore: () => void;
  onPurge: () => void;
  isRestoring: boolean;
  isPurging: boolean;
}>) {
  const Icon = TYPE_ICON[item.entityType];
  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2"
      data-testid={`recycle-bin-item-${item.id}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{item.label}</span>
            <Badge variant="secondary" className="shrink-0 text-xs font-normal">
              {TYPE_LABEL[item.entityType]}
            </Badge>
          </div>
          {item.summary && <p className="truncate text-xs text-muted-foreground">{item.summary}</p>}
          <p className="text-xs text-muted-foreground">
            {item.entityDate ? `${item.entityDate} · ` : ""}
            Deleted {formatDistanceToNow(new Date(item.deletedAt), { addSuffix: true })} ·{" "}
            {expiryCopy(item.expiresAt, now)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onRestore}
          disabled={isRestoring || isPurging}
          data-testid={`button-restore-${item.id}`}
        >
          <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
          Restore
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${item.label} forever`}
                onClick={(e) => {
                  if (isRestoring || isPurging) e.preventDefault();
                  else onPurge();
                }}
                aria-disabled={isRestoring || isPurging}
                className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                data-testid={`button-purge-${item.id}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete forever</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </li>
  );
}

/**
 * Settings → Recycle bin (its own tab, `?tab=recycle-bin`). The durable way back for a deleted
 * workout, plan day or training plan (the delete toast's Undo is the quick
 * one). Restore puts the record back exactly, with the same id; "Delete
 * forever" and "Empty bin" are the only irreversible actions on the page, so
 * both confirm first.
 */
export function RecycleBinCard() {
  const { data, isLoading, isError } = useRecycleBin();
  const restore = useRestoreRecycleBinItem();
  const purge = usePurgeRecycleBinItem();
  const empty = useEmptyRecycleBin();
  const [pendingPurge, setPendingPurge] = useState<RecycleBinListItem | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const now = new Date();

  const items = data?.items ?? [];
  const total = data?.counts.total ?? 0;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-2" data-testid="recycle-bin-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (isError) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="recycle-bin-error">
        Couldn't load the recycle bin right now. Please try again.
      </p>
    );
  } else if (items.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="recycle-bin-empty">
        Nothing in the bin. Deleted workouts, plan days and training plans will show up here.
      </p>
    );
  } else {
    body = (
      <ul className="divide-y rounded-md border" data-testid="recycle-bin-list">
        {items.map((item) => (
          <RecycleBinRow
            key={item.id}
            item={item}
            now={now}
            onRestore={() => restore.mutate(item.id)}
            onPurge={() => setPendingPurge(item)}
            isRestoring={restore.isPending && restore.variables === item.id}
            isPurging={purge.isPending && purge.variables === item.id}
          />
        ))}
      </ul>
    );
  }

  return (
    <Card data-testid="recycle-bin-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle as="h2" className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              Recycle bin
              {total > 0 && (
                <Badge variant="secondary" data-testid="recycle-bin-count">
                  {total}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Deleted workouts, plan days and training plans are kept for 90 days. Restore puts them
              back exactly as they were.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmEmpty(true)}
            disabled={isLoading || total === 0 || empty.isPending}
            data-testid="button-empty-recycle-bin"
          >
            Empty bin
          </Button>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>

      <ConfirmDialog
        open={pendingPurge !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPurge(null);
        }}
        title="Delete forever?"
        description={
          pendingPurge
            ? `"${pendingPurge.label}" will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmText="Delete forever"
        isDestructive
        isPending={purge.isPending}
        cancelTestId="cancel-purge-item"
        confirmTestId="confirm-purge-item"
        onConfirm={() => {
          if (!pendingPurge) return;
          purge.mutate(pendingPurge.id, { onSettled: () => setPendingPurge(null) });
        }}
      />

      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="Empty the recycle bin?"
        description={`${total === 1 ? "1 item" : total + " items"} will be permanently deleted. This cannot be undone.`}
        confirmText="Empty bin"
        isDestructive
        isPending={empty.isPending}
        cancelTestId="cancel-empty-recycle-bin"
        confirmTestId="confirm-empty-recycle-bin"
        onConfirm={() => {
          empty.mutate(undefined, { onSettled: () => setConfirmEmpty(false) });
        }}
      />
    </Card>
  );
}
